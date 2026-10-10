'use strict';

// Core performance guard.
//
// These are regression guards, not micro-benchmarks. Each ceiling is set well
// above the measured cost on a reference machine (see CORE.md) so ordinary CI
// jitter never trips them, while a real performance regression — an accidental
// O(n^2) in the parser, a per-row re-allocation, a sort inside a hot loop — is
// caught before it reaches users. The point is to keep the radio-facing hot
// paths fast and predictable, not to police nanoseconds.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const rf = require(path.join(__dirname, '..', 'js', 'rf-log.js'));
const fc = require(path.join(__dirname, '..', 'js', 'flash-catalog.js'));

const ROW_SIZE = 25;

// Build a realistic full RF Log packet: status header + live row + 64 rows.
function makeMainPacket() {
  const buf = new Uint8Array(rf.PACKET_SIZE);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 2); // protocol version
  dv.setUint8(1, 0x03); // active + hasTraffic
  dv.setUint8(2, 64); // row count
  let offset = rf.STATUS_PACKET_SIZE;
  for (let i = 0; i < rf.ROW_COUNT + 1; i++, offset += ROW_SIZE) {
    dv.setUint32(offset, 145000000 + i * 12500, true); // frequency
    dv.setUint32(offset + 4, 1000 + i, true); // sequence
    dv.setUint16(offset + 8, 3, true); // duration
    dv.setUint8(offset + 12, i % 2); // flags
    dv.setUint8(offset + 13, 5); // meter
    dv.setUint8(offset + 14, 120); // battery
  }
  return buf;
}

// A large row set approximating a long RF Log session for bulk operations.
function makeRows(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      sequence: i,
      frequency: 145000000 + (i % 500) * 12500,
      durationSeconds: i % 60,
      channel: i % 40,
      flags:
        (i % 50 === 0 ? rf.FLAG_SESSION : 0) | (i % 3 === 0 ? rf.FLAG_TX : 0),
      meter: i % 15,
      battVolt: 120,
      channelName: 'CH' + (i % 40),
    });
  }
  return rows;
}

// A catalog listing larger than any real one, to stress grouping/sorting.
function makeCatalog(size) {
  const files = [];
  for (let i = 0; i < size; i++) {
    files.push({
      name: `f4hwn.fusion.v5.${i}.bin`,
      size: 85000,
      download_url: 'x',
    });
    files.push({
      name: `f4hwn.fieldops.v6.${i % 9}.bin`,
      size: 85000,
      download_url: 'x',
    });
    files.push({
      name: `quansheng.k1.stock.firmware.v7.0${i % 9}.0${i % 9}.bin`,
      size: 62000,
      download_url: 'x',
    });
  }
  return files;
}

// Run fn `iters` times and return elapsed milliseconds. Two warmup calls keep
// the measurement off the JIT cold path so the ceiling reflects steady state.
function measure(iters, fn) {
  fn();
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const mainPacket = makeMainPacket();
const historyPacket = new Uint8Array(rf.HISTORY_PACKET_SIZE);
const bigRows = makeRows(5000);
const catalog = makeCatalog(400); // 1200 entries

test('parses a full RF Log packet well within a real-time budget', () => {
  // Baseline ~9us/packet. Ceiling 2ms/packet is ~200x headroom and still far
  // below the serial frame interval, so a quadratic parser would fail loudly.
  const ms = measure(20000, () => rf.parseMainPacket(mainPacket));
  assert.ok(
    ms / 20000 < 2,
    `parseMainPacket too slow: ${((ms / 20000) * 1000).toFixed(1)}us/packet`,
  );
});

test('parses an RF Log history packet well within a real-time budget', () => {
  const ms = measure(20000, () => rf.parseHistoryPacket(historyPacket));
  assert.ok(
    ms / 20000 < 2,
    `parseHistoryPacket too slow: ${((ms / 20000) * 1000).toFixed(1)}us/packet`,
  );
});

test('renders a 5000-row CSV export without a pathological blow-up', () => {
  // Baseline ~10ms. Ceiling 250ms leaves room for slower CI while catching an
  // accidental per-row re-sort or string-concat quadratic.
  const ms = measure(200, () => rf.rowsToCsv(bigRows));
  assert.ok(
    ms / 200 < 250,
    `rowsToCsv too slow: ${(ms / 200).toFixed(1)}ms/call`,
  );
});

test('limits and groups 5000 rows without a pathological blow-up', () => {
  const limitMs = measure(500, () => rf.limitVisibleRows(bigRows));
  assert.ok(
    limitMs / 500 < 100,
    `limitVisibleRows too slow: ${(limitMs / 500).toFixed(1)}ms/call`,
  );

  const groupMs = measure(500, () => rf.groupRowsBySession(bigRows));
  assert.ok(
    groupMs / 500 < 100,
    `groupRowsBySession too slow: ${(groupMs / 500).toFixed(1)}ms/call`,
  );
});

test('groups and sorts a large firmware catalog efficiently', () => {
  const categorizeMs = measure(100, () => fc.categorize(catalog));
  assert.ok(
    categorizeMs / 100 < 150,
    `categorize too slow: ${(categorizeMs / 100).toFixed(1)}ms/call`,
  );

  const parsed = catalog
    .map((f) => fc.parseFirmwareName(f.name))
    .filter(Boolean);
  const sortMs = measure(200, () => {
    parsed.slice().sort((a, b) => fc.compareVersionDesc(a.version, b.version));
  });
  assert.ok(
    sortMs / 200 < 150,
    `catalog sort too slow: ${(sortMs / 200).toFixed(1)}ms/call`,
  );
});
