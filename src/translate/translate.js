import { translateChunkViaAi } from '../ai-assist/index.js';

// --- Numeric/reference-code detection (for post-hoc verification) --------
// Kept unchanged from the local-model era: regardless of which engine
// produced a translation, a figure or reference code that doesn't
// survive verbatim into the output is worth flagging for the
// investigator to check against the original -- see
// project memory's translation-triage-purpose for why this is judged by
// "would this flip a triage call," not "is this accurate."
const REFERENCE_CODE_RE = /\b[A-Z]{2,6}-[A-Z0-9-]+\b/g;
const NUMERIC_SPAN_RE = /(?<![A-Za-z])\$?\d[\d,]*(?:\.\d+)?%?/g;

function extractNumericSpans(text) {
  const codes = [...new Set([...text.matchAll(REFERENCE_CODE_RE)].map((m) => m[0]))];
  const numbers = [...new Set([...text.matchAll(NUMERIC_SPAN_RE)].map((m) => m[0]))]
    .filter((num) => !codes.some((code) => code.includes(num)));
  return [...codes, ...numbers];
}

/**
 * Translates text into English via the investigator's configured AI
 * endpoint (see src/ai-assist/) -- replaces the previously bundled local
 * ONNX models (Marian/mT5), per the 2026-11 decision to trim anything
 * replaceable by an API call. The source language is no longer picked by
 * the investigator beforehand: a modern general-purpose model detects it
 * reliably on its own (see each provider's translateChunk()), which the
 * old per-language local models could not do. Throws a clear, catchable
 * error when no AI endpoint is configured, same contract as
 * src/extract/ocr.js, so callers (translate-record.js) surface that as an
 * ordinary failure rather than a crash.
 *
 * Splits on paragraph breaks and translates each paragraph in one call --
 * unlike the old small local models, a modern hosted model doesn't need
 * sentence-level chunking to stay coherent, and fewer/larger calls means
 * fewer round trips. meta.sourceNumericSpans /
 * meta.numericSpansMissingInTranslation are still computed the same way
 * as before: translation (local or API) is never trusted to preserve
 * figures/codes, so they're extracted from the untouched original and
 * checked against the output.
 */
export async function translateText(text) {
  if (!text) {
    return { text: '', meta: {} };
  }

  const paragraphs = text.split(/\n\s*\n/);
  const translatedParagraphs = [];
  let meta = {};
  for (const para of paragraphs) {
    if (!para.trim()) {
      translatedParagraphs.push('');
      continue;
    }
    const result = await translateChunkViaAi(para);
    if (!result) {
      throw new Error('translateText: no AI endpoint configured (see ai-config.json in the case workspace folder)');
    }
    translatedParagraphs.push(result.text);
    // Later paragraphs win on a shared key -- detectedLanguage is a
    // best-effort per-call guess, not guaranteed identical across
    // paragraphs of the same message; not worth reconciling for a
    // display-only label.
    meta = { ...meta, ...result.meta };
  }
  const translatedText = translatedParagraphs.join('\n\n');

  const sourceNumericSpans = extractNumericSpans(text);
  meta.sourceNumericSpans = sourceNumericSpans;
  meta.numericSpansMissingInTranslation = sourceNumericSpans.filter((span) => !translatedText.includes(span));

  return { text: translatedText, meta };
}
