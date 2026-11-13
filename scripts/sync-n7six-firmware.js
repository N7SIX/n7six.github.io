'use strict';

// Mirrors the firmware images published as GitHub releases by N7SIX into
// UVStudio/firmware/n7six/ so UV Studio can fetch them same-origin (GitHub
// release downloads are not CORS-enabled) and writes the manifest it reads.

const fs = require('node:fs');
const path = require('node:path');

const REPOS = [
  'N7SIX/UV-K1Series_ApeX-Edition_v7.6.0',
  'N7SIX/UV-K1Series_ApeXLabs-Edition_v7.6.0',
];
const OUTPUT_DIR = path.join(__dirname, '..', 'UVStudio', 'firmware', 'n7six');
const FIRMWARE_NAME =
  /^n7six[._-]apex(?:labs)?(?:[._-](?:k1|k5v3))?(?:[._-].*)?\.bin$/i;
// Earlier builds are intentionally not offered.
const MIN_VERSION = [7, 6, 11];

function isOfferedVersion(name) {
  const match = name.match(/[._-]v(\d+(?:\.\d+)*)/i);
  if (!match) return false;
  const parts = match[1].split('.').map(Number);
  for (let i = 0; i < MIN_VERSION.length; i += 1) {
    const diff = (parts[i] || 0) - MIN_VERSION[i];
    if (diff !== 0) return diff > 0;
  }
  return true;
}

// Newest release first; the first asset seen for a name wins.
function selectFirmwareAssets(releases) {
  const byName = new Map();
  (Array.isArray(releases) ? releases : []).forEach((release) => {
    if (!release || release.draft || release.prerelease) return;
    (release.assets || []).forEach((asset) => {
      if (
        !asset ||
        !FIRMWARE_NAME.test(asset.name) ||
        !isOfferedVersion(asset.name) ||
        byName.has(asset.name)
      ) {
        return;
      }
      byName.set(asset.name, {
        name: asset.name,
        size: asset.size,
        tag: release.tag_name,
        url: asset.browser_download_url,
      });
    });
  });
  return Array.from(byName.values());
}

function apiHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'n7six-firmware-sync',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchReleases(repo) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      { headers: apiHeaders() },
    );
    if (response.status === 404) return releases; // repository not published
    if (!response.ok) throw new Error(`${repo}: HTTP ${response.status}`);
    const batch = await response.json();
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

async function download(url, target) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'n7six-firmware-sync' },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, data);
  return data.length;
}

async function main() {
  const releases = [];
  for (const repo of REPOS) releases.push(...(await fetchReleases(repo)));
  const assets = selectFirmwareAssets(releases);
  if (!assets.length) {
    throw new Error('No N7SIX firmware assets found; aborting.');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = [];
  for (const asset of assets) {
    const target = path.join(OUTPUT_DIR, asset.name);
    const present =
      fs.existsSync(target) && fs.statSync(target).size === asset.size;
    if (!present) {
      const size = await download(asset.url, target);
      if (size !== asset.size) {
        throw new Error(
          `${asset.name}: expected ${asset.size} bytes, got ${size}`,
        );
      }
      console.log(`Downloaded ${asset.name}`);
    }
    files.push({ name: asset.name, size: asset.size, tag: asset.tag });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  const wanted = new Set(files.map((file) => file.name));
  fs.readdirSync(OUTPUT_DIR).forEach((entry) => {
    if (entry.toLowerCase().endsWith('.bin') && !wanted.has(entry)) {
      fs.unlinkSync(path.join(OUTPUT_DIR, entry));
      console.log(`Removed ${entry}`);
    }
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify({ files }, null, 2)}\n`,
  );
  console.log(`Manifest lists ${files.length} firmware images.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { selectFirmwareAssets };
