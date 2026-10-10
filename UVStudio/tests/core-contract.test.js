'use strict';

// Core contract guard.
//
// The "core" of UV Studio is the set of pure, DOM-free modules that implement
// the radio protocol, the serial-ownership rules, preference storage, the
// translation engine, and the firmware/app catalogs. Their public surfaces are
// the contract the UI/UX and feature layers build on. This suite locks that
// contract so a future UI/UX or feature change cannot silently rename, remove,
// or repurpose a core export, break the frozen globals, drift a protocol
// constant, or reorder the script dependency graph in index.html.
//
// Rules encoded here (see CORE.md):
//   * Required exports must exist and keep their type. New exports are allowed
//     (features may extend the core) but existing ones may not be removed.
//   * Frozen public globals must stay frozen.
//   * Protocol constants must stay internally consistent.
//   * The <script> load order in index.html must keep every dependency before
//     its first consumer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const js = (name) => fs.readFileSync(path.join(root, 'js', name), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Minimal browser shim so the browser-only modules can self-boot under Node.
function loadGlobal(relPath, extra = {}) {
  const context = Object.assign(
    {
      window: { addEventListener() {}, dispatchEvent() {} },
      document: {
        documentElement: { dataset: {} },
        getElementById() {
          return null;
        },
        querySelectorAll() {
          return { forEach() {} };
        },
        addEventListener() {},
      },
      CustomEvent: class {
        constructor(type, options = {}) {
          this.type = type;
          this.detail = options.detail;
        }
      },
      navigator: {},
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {},
        removeItem() {},
      },
      console,
    },
    extra,
  );
  vm.runInNewContext(js(relPath), context, { filename: relPath });

  // ---------------------------------------------------------------------------
  // rf-log.js — RF Log protocol + CSV (window.UVTOOLS_RF_LOG)
  // ---------------------------------------------------------------------------
  test('rf-log keeps its required protocol and CSV exports', () => {
    const api = require(path.join(root, 'js', 'rf-log.js'));
    for (const fn of [
      'takeViewerFrame',
      'parseMainPacket',
      'parseHistoryPacket',
      'mergeRows',
      'limitVisibleRows',
      'groupRowsBySession',
      'countDistinctMemoryChannels',
      'rowsToCsv',
      'featureKeepalive',
    ]) {
      assert.equal(typeof api[fn], 'function', `rf-log must export ${fn}()`);
    }
    for (const constant of [
      'TYPE_RF_LOG',
      'TYPE_RF_LOG_HISTORY',
      'ROW_COUNT',
      'VISIBLE_TRAFFIC_COUNT',
      'STATUS_PACKET_SIZE',
      'PACKET_SIZE',
      'HISTORY_PACKET_SIZE',
      'POWER_LABELS',
    ]) {
      assert.ok(constant in api, `rf-log must export ${constant}`);
    }
  });

  test('rf-log protocol constants stay internally consistent', () => {
    const api = require(path.join(root, 'js', 'rf-log.js'));
    // ROW_COUNT rows plus one live row, prefixed by the status packet.
    assert.equal(
      api.PACKET_SIZE,
      api.STATUS_PACKET_SIZE + 25 * (api.ROW_COUNT + 1),
    );
    assert.equal(api.HISTORY_PACKET_SIZE, 25 * api.ROW_COUNT);
    assert.equal(api.ROW_COUNT, 64);
    assert.equal(api.VISIBLE_TRAFFIC_COUNT, 512);
    assert.equal(api.STATUS_PACKET_SIZE, 4);
    assert.equal(api.TYPE_RF_LOG, 0x05);
    assert.equal(api.TYPE_RF_LOG_HISTORY, 0x06);
  });

  // ---------------------------------------------------------------------------
  // flash-catalog.js — firmware parsing/grouping (window.UVStudioFlashCatalog)
  // ---------------------------------------------------------------------------
  test('flash-catalog keeps its required exports', () => {
    const api = require(path.join(root, 'js', 'flash-catalog.js'));
    for (const fn of [
      'parseFirmwareName',
      'compareVersionDesc',
      'categorize',
      'formatOptionLabel',
      'hasSharedChirpDriver',
      'isOffered',
      'isSlotOffered',
      'mergeCatalogFiles',
    ]) {
      assert.equal(
        typeof api[fn],
        'function',
        `flash-catalog must export ${fn}()`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // app-catalog.js — overlay-app discovery (window.UVStudioAppCatalog)
  // ---------------------------------------------------------------------------
  test('app-catalog keeps its required exports', () => {
    const api = require(path.join(root, 'js', 'app-catalog.js'));
    for (const fn of [
      'boot',
      'compareVersionsDesc',
      'contentsURL',
      'displayAppName',
      'formatAppLabel',
      'listApps',
      'listVersions',
      'parseAppHeader',
      'parseVersionDirectory',
      'readAppMetadata',
    ]) {
      assert.equal(
        typeof api[fn],
        'function',
        `app-catalog must export ${fn}()`,
      );
    }
  });

  return context;
}

// ---------------------------------------------------------------------------
// studio-serial.js — exclusive serial ownership (window.UVStudioSerial, frozen)
// ---------------------------------------------------------------------------
test('studio-serial keeps its frozen controller contract', () => {
  const context = loadGlobal('studio-serial.js');
  const controller = context.window.UVStudioSerial;
  assert.ok(controller, 'window.UVStudioSerial must be defined');
  assert.equal(
    Object.isFrozen(controller),
    true,
    'serial controller must stay frozen',
  );
  for (const fn of [
    'register',
    'closeResources',
    'releaseFor',
    'releaseCurrent',
    'getSnapshot',
    'isNavigationBlocked',
  ]) {
    assert.equal(
      typeof controller[fn],
      'function',
      `serial controller must expose ${fn}()`,
    );
  }
});

// ---------------------------------------------------------------------------
// studio-preferences.js — resilient storage (window.UVStudioPreferences, frozen)
// ---------------------------------------------------------------------------
test('studio-preferences keeps its frozen storage contract', () => {
  const context = loadGlobal('studio-preferences.js');
  const prefs = context.window.UVStudioPreferences;
  assert.ok(prefs, 'window.UVStudioPreferences must be defined');
  assert.equal(Object.isFrozen(prefs), true, 'preferences must stay frozen');
  for (const fn of ['get', 'set', 'remove']) {
    assert.equal(
      typeof prefs[fn],
      'function',
      `preferences must expose ${fn}()`,
    );
  }
});

// ---------------------------------------------------------------------------
// studio-i18n.js — translation runtime (window.uvStudioI18n)
// ---------------------------------------------------------------------------
test('studio-i18n keeps its translation contract', () => {
  const context = loadGlobal('studio-i18n.js', {
    window: {
      addEventListener() {},
      dispatchEvent() {},
      UVSTUDIO_LOCALES: { en: { hello: 'Hello' } },
      UVStudioPreferences: {
        get() {
          return '';
        },
        set() {},
        remove() {},
      },
    },
  });
  const i18n = context.window.uvStudioI18n;
  assert.ok(i18n, 'window.uvStudioI18n must be defined');
  for (const fn of ['t', 'apply', 'setLanguage', 'init']) {
    assert.equal(typeof i18n[fn], 'function', `i18n must expose ${fn}()`);
  }
});

// ---------------------------------------------------------------------------
// studio-version.js — single source of truth for the public version
// ---------------------------------------------------------------------------
test('studio-version exposes a semantic version string', () => {
  const context = loadGlobal('studio-version.js');
  const version = context.window.UVSTUDIO_VERSION;
  assert.equal(typeof version, 'string');
  assert.match(
    version,
    /^\d+\.\d+\.\d+$/,
    'version must be semver (major.minor.patch)',
  );
});

// ---------------------------------------------------------------------------
// flash.js — firmware operations entry point (window.UVStudioFlash, frozen)
// The full module needs a live DOM, so we assert the frozen contract textually.
// ---------------------------------------------------------------------------
test('flash.js publishes a frozen window.UVStudioFlash entry point', () => {
  const source = js('flash.js');
  assert.match(
    source,
    /window\.UVStudioFlash\s*=\s*Object\.freeze\(\{/,
    'flash.js must publish window.UVStudioFlash as a frozen object',
  );
  for (const fn of [
    'loadFirmwareFromURL',
    'loadSlotFirmwareFromURL',
    'loadAppFromURL',
    'clearAppFromCatalog',
    'hasFirmware',
  ]) {
    assert.ok(source.includes(fn), `window.UVStudioFlash must expose ${fn}`);
  }
});

// ---------------------------------------------------------------------------
// index.html — script dependency graph must stay correctly ordered
// ---------------------------------------------------------------------------
function scriptIndex(token) {
  const idx = html.indexOf(token);
  assert.notEqual(idx, -1, `index.html must load ${token}`);
  return idx;
}

test('index.html loads every core module before its consumers', () => {
  // studio-preferences boots before i18n and serial, which depend on it.
  assert.ok(
    scriptIndex('js/studio-preferences.js') < scriptIndex('js/studio-i18n.js'),
    'studio-preferences must load before studio-i18n',
  );
  assert.ok(
    scriptIndex('js/studio-preferences.js') <
      scriptIndex('js/studio-serial.js'),
    'studio-preferences must load before studio-serial',
  );
  // Locales must be present before the i18n runtime reads them.
  assert.ok(
    scriptIndex('locales/en.js') < scriptIndex('js/studio-i18n.js'),
    'locale dictionaries must load before studio-i18n',
  );
  // Serial ownership must exist before the viewer, flasher, and shell use it.
  assert.ok(
    scriptIndex('js/studio-serial.js') < scriptIndex('js/k5viewer.js'),
    'studio-serial must load before k5viewer',
  );
  assert.ok(
    scriptIndex('js/studio-serial.js') < scriptIndex('js/flash.js'),
    'studio-serial must load before flash',
  );
  assert.ok(
    scriptIndex('js/studio-serial.js') < scriptIndex('js/studio.js'),
    'studio-serial must load before the studio shell',
  );
  // Catalogs publish into window.UVStudioFlash, so flash must boot first.
  assert.ok(
    scriptIndex('js/flash.js') < scriptIndex('js/flash-catalog.js'),
    'flash must load before flash-catalog',
  );
  assert.ok(
    scriptIndex('js/flash.js') < scriptIndex('js/app-catalog.js'),
    'flash must load before app-catalog',
  );
  // The shell coordinates everything and loads last.
  assert.ok(
    scriptIndex('js/app-catalog.js') < scriptIndex('js/studio.js'),
    'app-catalog must load before the studio shell',
  );
});
