import fs from 'node:fs';
import { createRequire } from 'node:module';

// ocr.js's looksLikeSupportedImage() -- a plain magic-byte sniff with no
// AI/network involvement -- is imported by magic-bytes.js and reached by
// plenty of tests that run under plain `node --test`, never inside the
// real Electron runtime. A static `import { safeStorage } from
// 'electron'` breaks those: outside Electron, the 'electron' package on
// disk is just an npm stub exporting a string (the path to the Electron
// binary), not an object with named exports, so ESM's named-import
// binding throws at module-load time before any test body even runs.
// require() doesn't care that it got a string back -- destructuring off
// it just yields undefined, which isEncryptionAvailable() below treats
// as "not available" instead of crashing. Inside the real Electron main
// process (this module's only real caller), Electron's own loader
// intercepts 'electron' specially regardless of require vs import, so
// this still resolves to the genuine safeStorage API there.
const safeStorage = createRequire(import.meta.url)('electron')?.safeStorage;

function encryptionAvailable() {
  return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
}

// The ONE deliberate, scoped exception to this project's zero-network
// rule (see test/no-network-primitives.test.js's NETWORK_ALLOWED_DIR_
// PREFIXES) -- OCR and translation now call out to an AI API instead of
// bundling Tesseract/local ONNX models, per the 2026-11 decision to trim
// anything replaceable by an API call. The app's core (parsing, search,
// threading, crypto-detect, Focus Set, audit log) never calls this
// module and still runs with zero network access.
//
// Deliberately per-MACHINE (electron.app.getPath('userData')), not
// per-workspace: a case workspace is designed to be portable (lives
// beside the source archive, copies cleanly to another machine or
// external drive), and a credential must never travel along with it by
// accident -- confirmed directly by the investigator (2026-11) after the
// first version of this put ai-config.json inside the workspace folder.
//
// Resolved lazily from an env var (set once by electron/main.js in
// app.whenReady(), before any workspace is even chosen) rather than
// imported eagerly, for the same reason ocr.js's getMergedLangDir() is
// lazy: this module may be imported before that env var is set.
function configPath() {
  return process.env.AI_CONFIG_PATH || null;
}

const TEMPLATE = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  orgId: '',
  _comment:
    "Fill in baseUrl/apiKey/model for whatever AI endpoint you've approved for this work -- OpenAI, Grok (https://api.x.ai/v1), a local/self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM), or an organization's own AI gateway, since all of those speak the same request shape. orgId is optional (OpenAI accounts in multiple orgs only). 'provider' currently only supports \"openai-compatible\"; leave apiKey empty to run fully offline -- OCR and translation will report unavailable instead of failing. Paste the real key into apiKey below and save -- the app encrypts it at rest (OS-level, via Electron safeStorage/Windows DPAPI) the next time it starts and clears this plaintext field, so it only ever sits in plaintext on disk for the one save you just did.",
};

// An API key is a credential, not case data -- it must not sit in
// plaintext on disk indefinitely, which any serious security review of
// this app will check for. Electron's safeStorage wraps the OS's own
// secret store (Windows DPAPI, macOS Keychain, Linux libsecret) -- no
// new dependency, no network call, still works air-gapped.
// The investigator's existing workflow (hand-edit the JSON file, paste
// the key, save) is preserved: loadAiConfig() transparently encrypts any
// plaintext apiKey it finds and rewrites the file before returning, so
// the only plaintext exposure is the one save the investigator just did.
function encryptKey(apiKey) {
  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptKey(encoded) {
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}

/**
 * Returns the current AI config, or null when unconfigured (no file yet,
 * or apiKey/baseUrl left blank) -- callers treat null as "feature
 * unavailable," never as an error, since this app must still run with no
 * internet access. Writes a template file on first call so there's
 * something for the investigator to edit, same "create the thing the
 * user needs to act on" spirit as workspace confirmation elsewhere in
 * this app.
 */
export function loadAiConfig() {
  const p = configPath();
  if (!p) return null;
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(TEMPLATE, null, 2), 'utf8');
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }

  let apiKey = parsed.apiKey || '';
  const canEncrypt = encryptionAvailable();

  if (apiKey && canEncrypt) {
    // Plaintext key found (first save, or a hand-edit overwriting the
    // encrypted one) -- upgrade it in place immediately, never leave it
    // sitting in plaintext past this one load.
    const rewritten = { ...parsed, apiKey: '', apiKeyEncrypted: encryptKey(apiKey) };
    fs.writeFileSync(p, JSON.stringify(rewritten, null, 2), 'utf8');
  } else if (!apiKey && parsed.apiKeyEncrypted) {
    if (!canEncrypt) return null; // can't decrypt here; treat as unconfigured rather than crash
    try {
      apiKey = decryptKey(parsed.apiKeyEncrypted);
    } catch {
      return null; // encrypted under a different OS user/machine key -- unreadable, not a crash
    }
  }

  if (!apiKey || !parsed.baseUrl) return null;
  return { ...parsed, apiKey };
}

/**
 * Writes a new AI config from the renderer's AI Settings form (see
 * electron/main.js's 'save-ai-config' handler) -- the UI counterpart to
 * hand-editing the JSON file, for the investigator who'd rather use a
 * dropdown + fields than find and edit a file under AppData. Encrypts
 * the key immediately, same guarantee as loadAiConfig()'s transparent
 * upgrade: it is never written to disk in plaintext past this one call.
 *
 * apiKey is left blank ('') to mean "no change" -- e.g. switching the
 * model name shouldn't silently wipe an already-working key just
 * because the password-style field was (correctly) never pre-filled
 * with it. Pass clearKey: true to actually remove a saved key; that's
 * the only way to clear one via this function.
 */
export function saveAiConfig({ provider, baseUrl, apiKey, model, orgId, clearKey = false }) {
  const p = configPath();
  if (!p) throw new Error('saveAiConfig: AI_CONFIG_PATH is not set');

  const canEncrypt = encryptionAvailable();
  const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const config = {
    provider: provider || 'openai-compatible',
    baseUrl: baseUrl || '',
    apiKey: '',
    model: model || '',
    orgId: orgId || '',
  };

  if (apiKey) {
    if (canEncrypt) config.apiKeyEncrypted = encryptKey(apiKey);
    else config.apiKey = apiKey; // best-effort fallback where OS-level encryption genuinely isn't available
  } else if (!clearKey) {
    // Carry the existing credential forward untouched -- never
    // re-encrypt/re-derive it, just keep whatever bytes were already
    // on disk (works whether that was apiKeyEncrypted or, on a system
    // with no OS-level encryption available, a plaintext apiKey).
    if (existing.apiKeyEncrypted) config.apiKeyEncrypted = existing.apiKeyEncrypted;
    else if (existing.apiKey) config.apiKey = existing.apiKey;
  }

  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * A safe-to-send-to-the-renderer summary of the current config --
 * provider/baseUrl/model/orgId and whether a key is actually present,
 * but never the key itself (decrypted or not). The AI Settings UI uses
 * this to show "currently configured: X" without the main process ever
 * handing a credential back across the IPC boundary once it's been
 * saved -- contextIsolation keeps the renderer off of Node/the
 * filesystem entirely, but there's no reason to rely on that alone when
 * "just don't send it" is simpler and just as effective.
 */
export function getAiConfigStatus() {
  const p = configPath();
  if (!p || !fs.existsSync(p)) return { configured: false, provider: '', baseUrl: '', model: '', orgId: '' };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { configured: false, provider: '', baseUrl: '', model: '', orgId: '' };
  }

  const hasKey = Boolean(parsed.apiKey || parsed.apiKeyEncrypted);
  return {
    configured: hasKey && Boolean(parsed.baseUrl),
    provider: parsed.provider || '',
    baseUrl: parsed.baseUrl || '',
    model: parsed.model || '',
    orgId: parsed.orgId || '',
  };
}
