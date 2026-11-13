import { translateChunkViaAi } from '../ai-assist/index.js';

// Same five languages as before, plus Greek (ell) -- it was a known,
// deliberate gap under the old bundled-ONNX-model approach (no
// pre-converted Marian model existed for el-en, and a hand-built
// tokenizer decoded into repetition-looping garbage; see git history
// prior to the 2026-11 AI-API switch for the full story), but an AI API
// has no such per-language model-availability problem, so it's back.
export const AVAILABLE_LANGS = {
  ara: 'Arabic',
  chi_sim: 'Chinese (Simplified)',
  rus: 'Russian',
  tur: 'Turkish',
  fas: 'Farsi',
  ell: 'Greek',
};

function normalizeLang(lang) {
  if (!lang || !AVAILABLE_LANGS[lang]) {
    throw new Error(`translateText: unsupported or missing source language code: ${lang}`);
  }
  return lang;
}

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
 * Translates text from the given source language into English via the
 * investigator's configured AI endpoint (see src/ai-assist/) -- replaces
 * the previously bundled local ONNX models (Marian/mT5), per the 2026-11
 * decision to trim anything replaceable by an API call. Throws a clear,
 * catchable error when no AI endpoint is configured, same contract as
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
export async function translateText(text, sourceLang) {
  const lang = normalizeLang(sourceLang);
  if (!text) {
    return { text: '', meta: { sourceLang: lang } };
  }

  const langName = AVAILABLE_LANGS[lang];
  const paragraphs = text.split(/\n\s*\n/);
  const translatedParagraphs = [];
  let meta = { sourceLang: lang };
  for (const para of paragraphs) {
    if (!para.trim()) {
      translatedParagraphs.push('');
      continue;
    }
    const result = await translateChunkViaAi(para, langName);
    if (!result) {
      throw new Error('translateText: no AI endpoint configured (see ai-config.json in the case workspace folder)');
    }
    translatedParagraphs.push(result.text);
    meta = { ...meta, ...result.meta };
  }
  const translatedText = translatedParagraphs.join('\n\n');

  const sourceNumericSpans = extractNumericSpans(text);
  meta.sourceNumericSpans = sourceNumericSpans;
  meta.numericSpansMissingInTranslation = sourceNumericSpans.filter((span) => !translatedText.includes(span));

  return { text: translatedText, meta };
}
