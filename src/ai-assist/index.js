import { loadAiConfig } from './config.js';
import * as openaiCompatible from './providers/openai-compatible.js';

// Only one provider wire-format is implemented so far (see providers/
// openai-compatible.js's own header for which real services that
// covers). Anthropic's Messages API and Gemini's generateContent use
// different request/response shapes -- adding either is a new file
// under providers/ exposing the same { ocrImage, translateChunk } pair,
// registered here. Nothing outside this directory needs to change.
const PROVIDERS = {
  'openai-compatible': openaiCompatible,
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
