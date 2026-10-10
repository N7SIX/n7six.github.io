# UV Studio — Core Protection Contract

This document defines what is considered the **core** of UV Studio, why it is
protected, and the rules for changing it. The core is the stable, radio-facing
foundation that the UI/UX and feature layers build on. Its **integrity** (it
keeps working correctly and safely) and **performance** (it stays fast on the
serial hot path) are the project's top priorities.

## Why protect the core

The core talks directly to the radio over Web Serial. A regression here can
misparse a packet, corrupt a flash write, drop the exclusive serial lock, or
slow the live display. Those failures are subtle, hardware-dependent, and hard
to reproduce. Everything above the core — layout, theming, new tools, new
languages — is safe to iterate on quickly.

## The boundary

### Core (LOCKED — behavior, API, and performance are protected)

| Module                     | Responsibility                                          | Public surface                        |
| -------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `js/rf-log.js`             | RF Log packet framing, parsing, sessions, CSV           | `window.UVTOOLS_RF_LOG`               |
| `js/studio-serial.js`      | Exclusive serial-port ownership, operation locking      | `window.UVStudioSerial` (frozen)      |
| `js/studio-preferences.js` | Resilient local/session preference storage              | `window.UVStudioPreferences` (frozen) |
| `js/studio-i18n.js`        | Translation runtime and language persistence            | `window.uvStudioI18n`                 |
| `js/studio-version.js`     | Single source of truth for the public version           | `window.UVSTUDIO_VERSION`             |
| `js/flash.js`              | Firmware, calibration, boot-logo, external-flash writes | `window.UVStudioFlash` (frozen)       |
| `js/flash-catalog.js`      | Firmware filename parsing, grouping, offering rules     | `window.UVStudioFlashCatalog`         |
| `js/app-catalog.js`        | Overlay-app discovery and header parsing                | `window.UVStudioAppCatalog`           |
| `js/k5viewer.js`           | Serial display protocol, keypad, RF Log integration     | (internal, loaded by the shell)       |

### UI/UX and features (OPEN — iterate freely)

- `index.html` markup and `css/*.css` styling, theming, layout, responsiveness
- `js/studio.js` navigation shell, `js/keypad-detach.js`, `js/background-keepalive.js`,
  `js/studio-flash-counter.js`, `js/timer-worker.js`
- `locales/*` translation **content** (new keys and languages are welcome)
- New tools, views, and integrations that **consume** the core through its
  public surface

## Rules for changing the core

1. **Do not remove or rename a required export.** The public surface of each
   core module is a contract. New exports are allowed (features may extend the
   core); deleting or renaming existing ones is not, because the UI and tests
   depend on them. `tests/core-contract.test.js` enforces this.
2. **Do not unfreeze a frozen global.** `window.UVStudioSerial`,
   `window.UVStudioPreferences`, and `window.UVStudioFlash` are `Object.freeze`d
   on purpose so no consumer can mutate shared state at runtime.
3. **Do not change a protocol constant.** Packet sizes, type bytes, row counts,
   and the visible-window size are part of the wire protocol. Changing them
   breaks compatibility with the radio firmware. `core-contract.test.js` pins
   their internal consistency.
4. **Do not reorder the script graph.** `index.html` must load every core
   dependency before its first consumer. The contract test checks the order.
5. **Keep the hot paths fast.** Packet parsing runs once per serial frame and
   CSV/catalog operations run on every refresh. `tests/core-performance.test.js`
   sets generous ceilings (well above measured cost) that still catch an
   accidental quadratic. If a change is legitimately slower, update the ceiling
   in that test **with a comment explaining why** — never by weakening the test
   to silence it.
6. **Prefer adding over editing.** When a new capability is needed, add a new
   module or a new export rather than changing the behavior of an existing one.
   This keeps the locked surface stable while the product grows.

## How the protection runs

- `tests/core-contract.test.js` — locks the public API surface, frozen globals,
  protocol-constant consistency, and the `index.html` script load order.
- `tests/core-performance.test.js` — regression ceilings on the hot paths.
- Both run in CI on every push and pull request (see `.github/workflows/ci.yml`,
  step "Test UV applications"), alongside the behavioral suites
  (`studio-serial`, `studio-preferences`, `rf-log`, `flash-catalog`,
  `app-catalog`, `static-integration`).

Run the whole guard locally:

```sh
node --test UVStudio/tests/*.test.js
```

## Reviewing core changes

Core files are listed in `.github/CODEOWNERS`, so any change to them requires a
review from the core owners. Treat a diff that touches `js/rf-log.js`,
`js/studio-serial.js`, `js/flash.js`, `js/k5viewer.js`, or the catalog modules
as a core change and justify it against the rules above.
