# Contributing

## Required gate: no network primitives, no case-specific names

This project is designed to run fully air-gapped and to never disclose a
specific data source (leak-site domain, case entity name) in its public
history. Two tests enforce this automatically as part of `npm test`:

- `test/no-network-primitives.test.js` -- fails if any first-party source
  file (`electron/`, `src/`, `renderer/src/`, `scripts/`) contains a
  network primitive (`fetch`, `XMLHttpRequest`, `http`/`https`/`net`
  usage, `WebSocket`, Electron's `autoUpdater`, etc.), or if
  `package.json`'s electron-builder config gains a `publish` key.
- `test/forbidden-terms.test.js` -- fails if any first-party file contains
  a known case-specific or leak-site term. The real terms are never
  stored in this repo; `test/forbidden-terms.json` holds only their
  sha256 hashes.

Both must pass before a change is merged. If a change legitimately needs
an exception (e.g. a documented future analysis-export phase that
explicitly leaves the air-gapped machine), get it reviewed rather than
weakening or removing the check.
