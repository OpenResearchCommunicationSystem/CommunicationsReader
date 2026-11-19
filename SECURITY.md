# Security posture

Communications Reader is an air-gapped-first communications analysis
tool for e-discovery and investigative research. This document is the
running record of its security architecture and the reasoning behind
it, for anyone doing a security/IT review before installing it.

This is a proof-of-concept research tool, not a fielded forensic
system -- nothing here establishes or claims chain-of-custody or
evidentiary handling.

## Air-gap architecture

The app's core (parsing, search, threading, crypto-indicator detection,
Focus Set, audit log, SQLite storage) makes zero network calls. This is
not just a design intent -- it's enforced by
[`test/no-network-primitives.test.js`](test/no-network-primitives.test.js),
which scans first-party source for network primitives (`fetch(`,
`XMLHttpRequest`, `http.request`, etc.) and fails the build if any are
found outside one explicit, scoped exception: `src/ai-assist/`.

## AI integration (the one network-capable module)

As of build 1.0.0.14, OCR and translation call out to an AI API
(OpenAI-compatible chat-completions wire format, or Anthropic's native
Messages API -- works with OpenAI, Grok, Anthropic, a local/self-hosted
server, or an organization's own AI gateway) instead of bundling
Tesseract and local ONNX translation models. This was a deliberate,
requested trade: it removed ~900MB of bundled model weights (the
portable exe dropped from ~1.0GB to ~118MB) in exchange for one scoped,
optional network dependency. The same AI integration also powers
Analyze Thread/Analyze Collection (plain-language summaries), entity
extraction, and follow-up Q&A over the Focus Set -- all routed through
the same `src/ai-assist/` module and subject to the same rules below.
Entity extraction and Q&A can optionally use a second, stronger
"analysis model" on the same endpoint/key, configured alongside the
main model.

Everything about this integration is designed to be refused safely:
- **Never automatic.** None of this ever runs on import -- confirmed as
  an absolute requirement, not a preference, after a real cost/control
  concern (a case can hold hundreds of thousands of images; OCR now
  costs a real per-call fee). Every action is only ever triggered by an
  investigator's own explicit click, one item/thread/Focus Set at a
  time.
- **Dedup before anything else touches the data.** Attachment bytes are
  size-capped and content-hash-deduplicated at the moment they're first
  materialized from base64 in the parser (`src/parser/message-parse.js`),
  before extraction, search indexing, crypto-indicator scanning, or any
  AI call -- so a badly-normalized source export that repeats the same
  attachment hundreds of times never gets OCR'd (or paid for) hundreds of
  times.
- **No internet required.** `loadAiConfig()` returns `null` when
  unconfigured; every caller treats that as "feature unavailable," never
  as an error. The app runs fully offline with AI simply turned off.
- **No vendor lock-in, no SDK.** The AI client is a single
  provider-agnostic module using plain `fetch`, not a vendor SDK --
  avoids pulling in a large dependency tree for something air-gapped
  deployments may not even be able to reach.

Thread/collection summaries, extracted entities, and Q&A conversation
history are case data, not credentials -- they're written to the case's
own SQLite database (`thread_summaries`, `entity_extractions`,
`qa_messages`), same as everything else the app derives from a case, so
they travel with the case workspace if it's copied elsewhere. Only the
AI API key itself is kept separate and per-machine (see below).

## Credential storage

The AI API key is a credential, not case data, so it is scoped and
protected differently from everything else in the app:

- **Per-machine, not per-case.** The key lives in
  `app.getPath('userData')/ai-config.json` -- this machine's own install
  location -- never inside a case workspace folder. A case workspace is
  designed to travel to another machine or drive; a credential must
  never travel with it by accident. (Confirmed directly after an earlier
  version of this put the config inside the portable workspace.)
- **Encrypted at rest.** `src/ai-assist/config.js` uses Electron's
  `safeStorage` (OS-backed: Windows DPAPI, macOS Keychain, Linux
  libsecret) to encrypt the key before it's written to disk. The
  investigator's existing
  workflow -- hand-edit the JSON file, paste the key, save -- still
  works: the first load after a save transparently encrypts the
  plaintext field and rewrites the file, so the key sits in plaintext on
  disk for at most one save, never indefinitely. See
  [`test/ai-config.test.js`](test/ai-config.test.js) for the regression
  coverage (encrypt-on-load, decrypt-on-load, and the fallback behavior
  when OS-level encryption genuinely isn't available).

## Electron hardening

`electron/main.js`'s `BrowserWindow` already ran with `contextIsolation:
true`, `nodeIntegration: false`, and `sandbox: true`; the preload script
(`electron/preload.cjs`) only exposes a fixed, explicit set of IPC calls
via `contextBridge` -- the renderer never touches Node, the filesystem,
or the database directly. On top of that baseline:

- **Content-Security-Policy.** `renderer/index.html` sets a maximal CSP
  (`default-src 'none'`, allowing only `'self'` for scripts/styles/fonts
  and `'self' data:` for images) -- the renderer never loads or needs
  remote content.
- **Navigation/new-window lockdown.** `will-navigate` and
  `setWindowOpenHandler` are both denied unconditionally
  (`hardenWindowNavigation()` in `electron/main.js`) -- this app never
  links anywhere, so any attempt to navigate away or open a second
  window is necessarily a bug or a malicious attachment/filename trying
  to pivot out of the renderer, never legitimate.
- **Electron fuses.** `package.json`'s `build.electronFuses` disables
  `runAsNode` and the `NODE_OPTIONS`/`--inspect` escape hatches, and
  enables cookie encryption plus ASAR integrity validation + "only load
  from ASAR" -- closes the known "run the packaged exe with
  `ELECTRON_RUN_AS_NODE=1` or `NODE_OPTIONS` to get arbitrary code
  execution" class of attack against a packaged Electron app.

## Dependency audit triage

`npm audit` findings as of this build, and why each is or isn't
addressed -- recorded here so a future review doesn't have to re-derive
this reasoning from scratch every time:

- **Fixed:** `brace-expansion` (DoS via unbounded/recursive expansion) --
  resolved via plain `npm audit fix`, no breaking change.
- **Not fixed, verified unreachable:** `uuid <11.1.1` ("missing buffer
  bounds check... when `buf` is provided"), pulled in by `exceljs`
  (used for `.xlsx` extraction). The only fix path is forcing `exceljs`
  down to `3.4.0` -- a real breaking downgrade of a production
  extraction feature. Checked `exceljs`'s own source
  (`xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`): it only ever calls
  `uuidv4()` with zero arguments, never passing the `buf` parameter the
  advisory requires to trigger. The vulnerable code path cannot be
  reached through how this app uses the library, so the downgrade isn't
  worth the regression risk.
- **Not fixed, build-time only, no upstream patch yet:** the
  `picomatch`/`fdir`/`tinyglobby`/`vite`/`@vitejs/plugin-react` chain and
  electron-builder's own `@electron/rebuild`/`@electron/universal`/
  `minimatch` chain. All of these are `devDependencies` -- build tooling
  only, never packaged into the shipped exe (electron-builder's
  `build.files` list includes only `electron/**`, `src/**`,
  `dist/renderer/**`, and `package.json`; the ~118MB portable build has
  no bundled dev tooling). The `picomatch` ReDoS advisory's affected
  range is `*` (every published version, no patched release exists yet),
  so `npm audit fix --force` would only downgrade `vite` to an old 6.x
  release without actually resolving the underlying issue. Nothing safe
  to do here beyond waiting for an upstream fix.

## Code signing

**Open item, not yet resolved.** The portable exe is currently
**unsigned** -- `package.json` has never had explicit signing
configuration (`CSC_LINK`/`win.certificateFile`), and an earlier build's
`signing with signtool.exe` relied on electron-builder auto-discovering
an ambient code-signing certificate in the Windows certificate store
that is no longer present on this build machine. Shipping unsigned means
Windows SmartScreen will flag it, and any organization's
AppLocker/WDAC-style publisher-rule policy may block it outright. This
needs a real Authenticode code-signing certificate (a free program for
qualifying open-source projects, e.g. SignPath.io, or a paid
OV/EV certificate) before any real distribution -- a decision for the
project owner, not something this document can resolve on its own.
