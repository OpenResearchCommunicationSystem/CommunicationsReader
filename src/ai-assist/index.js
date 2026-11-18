import { loadAiConfig } from './config.js';
import * as openaiCompatible from './providers/openai-compatible.js';
import * as anthropic from './providers/anthropic.js';

// Two provider wire-formats implemented so far (see each provider
// file's own header for exactly what it covers and why it's separate).
// Gemini's generateContent is a third, different shape -- adding it is
// a new file under providers/ exposing the same { ocrImage,
// translateChunk } pair, registered here. Nothing outside this
// directory needs to change.
const PROVIDERS = {
  'openai-compatible': openaiCompatible,
  anthropic,
};

export function isAiConfigured() {
  return loadAiConfig() !== null;
}

function getProvider() {
  const config = loadAiConfig();
  if (!config) return null;
  const impl = PROVIDERS[config.provider];
  if (!impl) throw new Error(`ai-assist: unknown provider "${config.provider}" in ai-config.json`);
  return { config, impl };
}

/**
 * Returns { text, meta } like the old Tesseract path, or null when no AI
 * endpoint is configured -- callers (src/extract/ocr.js) surface that as
 * "OCR unavailable" rather than an error, since this app must still work
 * with zero internet access.
 */
export async function ocrImageViaAi(imageBuffer, mimeType) {
  const provider = getProvider();
  if (!provider) return null;
  const text = await provider.impl.ocrImage(provider.config, imageBuffer, mimeType);
  return { text, meta: { ocrEngine: `ai:${provider.config.provider}:${provider.config.model}`, ocrConfidenceMean: null } };
}

/**
 * Returns { text, meta } like the old local-model path, or null when
 * unconfigured. meta.translationEngine records which provider/model
 * actually produced the output, since that now varies by investigator
 * setup rather than being a fixed bundled model.
 */
export async function translateChunkViaAi(text, langName) {
  const provider = getProvider();
  if (!provider) return null;
  const translated = await provider.impl.translateChunk(provider.config, text, langName);
  return { text: translated, meta: { translationEngine: `ai:${provider.config.provider}:${provider.config.model}` } };
}

/**
 * Returns { text, meta } (text is the plain-language summary), or null
 * when unconfigured -- same "null means unavailable, not an error"
 * contract as the two functions above. meta.summaryEngine records which
 * provider/model actually produced it, same reasoning as
 * meta.translationEngine.
 */
export async function summarizeThreadViaAi(text) {
  const provider = getProvider();
  if (!provider) return null;
  const summary = await provider.impl.summarizeThread(provider.config, text);
  return { text: summary, meta: { summaryEngine: `ai:${provider.config.provider}:${provider.config.model}` } };
}
