# Communications Reader

An air-gapped-first communications analysis tool for e-discovery and
investigative research. Import `.eml`/`.mbox` archives, search and
thread them, pull text out of attachments, flag crypto-related
indicators, curate a focus set, and export it as a clean text
transcript — all without the app ever needing network access, except
for one optional, explicitly-triggered AI feature.

This is a proof-of-concept research tool, not a fielded forensic
system. Nothing here establishes or claims chain-of-custody or
evidentiary handling.

## What it does

- **Import** `.eml`/`.mbox` archives (and Autopsy case exports) into a
  local SQLite database, with resumable imports and content-hash
  deduplication of attachments before anything else touches them.
- **Search** message content, jump straight to a message by its
  Reference ID, or look up an attachment by its content hash.
- **Thread** related messages together across datasets.
- **Extract text** from `.docx`/`.xlsx`/`.pptx`/PDF attachments
  deterministically (no AI involved).
- **OCR and translate**, on request only, via an AI API endpoint you
  configure — OpenAI, Grok, a local/self-hosted OpenAI-compatible
  server, or an organization's own AI gateway. Never runs
  automatically on import; see [SECURITY.md](SECURITY.md) for why.
- **Flag crypto-related indicators** in message/attachment text.
- **Curate a Focus Set** of messages and export it as a portable text
  transcript, with Reference IDs and Attachment Hash IDs preserved so
  you can jump back to the source.
- **Audit log** of every import, extraction, scan, and export.

## Building it

Requires Node.js (the engine this was built against ships `node:sqlite`
natively) and Windows for the packaged build.

```bash
npm install
npm run dev          # run it in dev mode
npm run package       # build the portable Windows exe (release/)
npm test              # run the test suite
```

The portable exe needs no installer and no internet access to run its
core features. OCR/translation stay disabled until you fill in
`ai-config.json` (created on first launch, stored per-machine, not
inside any case workspace) with an AI endpoint of your choice.

## Architecture notes

- **Air-gapped core, enforced automatically.** The app's core (parsing,
  search, threading, crypto-indicator detection, Focus Set, audit log)
  makes zero network calls, and `test/no-network-primitives.test.js`
  scans first-party source to keep it that way. The one deliberate
  exception is `src/ai-assist/`, used only when you've configured an
  endpoint and only when you explicitly trigger OCR/translation.
- **Dedup and size-limit before anything else touches the data.**
  Attachment bytes are capped and content-hash-deduplicated the moment
  they're decoded from the source archive, before extraction, search
  indexing, crypto scanning, or any AI call.
- **Credentials are per-machine, not per-case.** A case workspace is
  designed to be portable (copy it to another machine or drive); an AI
  API key never travels with it. It's also encrypted at rest — see
  [SECURITY.md](SECURITY.md).

See [SECURITY.md](SECURITY.md) for the full security posture and
[CONTRIBUTING.md](CONTRIBUTING.md) for the automated checks a change
has to pass.

## License

[MIT](LICENSE)
