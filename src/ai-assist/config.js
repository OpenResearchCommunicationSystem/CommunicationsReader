import fs from 'node:fs';

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
    "Fill in baseUrl/apiKey/model for whatever AI endpoint your organization has approved -- OpenAI, Grok (https://api.x.ai/v1), a local/self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM), or an org gateway such as GenAI.mil, since all of those speak the same request shape. orgId is optional (OpenAI accounts in multiple orgs only). 'provider' currently only supports \"openai-compatible\"; leave apiKey empty to run fully offline -- OCR and translation will report unavailable instead of failing.",
};

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
  if (!parsed.apiKey || !parsed.baseUrl) return null;
  return parsed;
}
