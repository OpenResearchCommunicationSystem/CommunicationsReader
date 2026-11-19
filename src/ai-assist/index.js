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

// Deep analysis (entity extraction, follow-up Q&A) is more demanding than
// OCR/translation, which both stay cheap and fast on purpose -- an
// investigator may reasonably want a stronger, more expensive model for
// one and not the other, on the SAME endpoint/credential rather than
// configuring a second provider from scratch. config.analysisModel is
// optional; when blank, analysis just uses the same model as everything
// else.
function getAnalysisConfig(config) {
  return { ...config, model: config.analysisModel || config.model };
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
 * setup rather than being a fixed bundled model. meta.detectedLanguage is
 * the model's own best guess at the source language (see each provider's
 * translateChunk()) -- display-only, never relied on for anything else,
 * since there's no way to verify it short of reading the original text.
 */
export async function translateChunkViaAi(text) {
  const provider = getProvider();
  if (!provider) return null;
  const { text: translated, detectedLanguage } = await provider.impl.translateChunk(provider.config, text);
  return {
    text: translated,
    meta: { translationEngine: `ai:${provider.config.provider}:${provider.config.model}`, detectedLanguage },
  };
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

/**
 * Returns { text, meta } (text is the AI's raw response, expected to be a
 * JSON array of entities -- parsing/validating that is the caller's job,
 * see src/forensics/entity-extraction.js), or null when unconfigured.
 * Uses the configured analysis model (see getAnalysisConfig() above),
 * which may be a stronger/more expensive model than the one OCR/
 * translation use. meta.analysisEngine records which provider/model
 * actually produced it, same role meta.summaryEngine plays above.
 */
export async function extractEntitiesViaAi(text) {
  const provider = getProvider();
  if (!provider) return null;
  const analysisConfig = getAnalysisConfig(provider.config);
  const raw = await provider.impl.extractEntities(analysisConfig, text);
  return { text: raw, meta: { analysisEngine: `ai:${analysisConfig.provider}:${analysisConfig.model}` } };
}

/**
 * Answers a follow-up question about an already-assembled collection
 * transcript, given the running conversation so far (messages: an array
 * of {role, content}, ending with the latest user question). Returns
 * { text, meta }, or null when unconfigured, same contract/analysis-model
 * use as extractEntitiesViaAi() above. See src/forensics/qa-chat.js for
 * how the conversation is persisted and replayed.
 */
export async function askQuestionViaAi(contextText, messages) {
  const provider = getProvider();
  if (!provider) return null;
  const analysisConfig = getAnalysisConfig(provider.config);
  const answer = await provider.impl.askQuestion(analysisConfig, contextText, messages);
  return { text: answer, meta: { analysisEngine: `ai:${analysisConfig.provider}:${analysisConfig.model}` } };
}
