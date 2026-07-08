import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env as transformersEnv } from '@huggingface/transformers';

const here = path.dirname(fileURLToPath(import.meta.url));

// Zero-network guarantee, mirroring src/extract/ocr.js's langPath comment.
// Verified by reading @huggingface/transformers' own source
// (src/utils/hub.js): when env.allowRemoteModels is false, getModelFile()
// throws synchronously ("env.allowRemoteModels=false, but attempted to
// load a remote file...") instead of ever falling back to a network fetch
// -- not a silent fallback, a hard error. local_files_only is also passed
// per-call below as defense in depth, same belt-and-suspenders spirit as
// the rest of this module.
transformersEnv.allowRemoteModels = false;

// Bundled ONNX weights live in models/translation/<code>/ (see
// scripts/fetch-translation-models.mjs), asarUnpack'd in package.json the
// same way tesseract.js-core is. Confirmed a real packaging bug here (same
// SHAPE as the one ocr.js's TESSDATA_CACHE_DIR comment describes, hit
// again despite that precedent): Electron's fs shim only redirects
// app.asar/... reads to the real app.asar.unpacked/... location for calls
// that go through Node's own fs module, which it monkey-patches --
// onnxruntime-node's native addon opens the .onnx file itself via the OS's
// file APIs directly, bypassing that patch entirely, so a path computed
// as if still inside the asar fails with "File doesn't exist" even though
// asarUnpack genuinely copied the file to a real location on disk.
// Confirmed via ELECTRON_RUN_AS_NODE against an actual packaged build, not
// assumed from working in dev. Fix: rewrite the computed path's
// app.asar segment to app.asar.unpacked explicitly -- a no-op when not
// running from inside a packed asar (dev, tests, the CLI).
function modelDir(code) {
  const dir = path.join(here, '..', '..', 'models', 'translation', code);
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
  return dir.includes(asarSegment) ? dir.split(asarSegment).join(unpackedSegment) : dir;
}

// English is deliberately not a source language: every language here
// exists to let the investigator read INCOMING foreign-language messages,
// not to compose new ones. Same code set as ocr.js's AVAILABLE_LANGS
// (minus 'eng'/'spa') so investigators pick from one consistent language
// list across OCR and translation -- MINUS 'ell' (Greek), see below.
//
// Greek is a known, deliberate gap, not an oversight: Helsinki-NLP's
// el-en Marian model has no pre-converted ONNX/tokenizer.json anywhere,
// and hand-building one (tried during implementation: converting
// source.spm to a tokenizers.js Unigram model, ID-aligned against
// vocab.json) produced a tokenizer that encodes correctly but decodes
// into repetition-looping garbage ("hello hello hello hello...") --
// almost certainly a decoder-side special-token/generation-config
// mismatch specific to Marian's fast-tokenizer emulation, not something
// safely fixable by guessing further. Shipping that would violate this
// project's own precedent of verifying a tool's actual output before
// relying on it (see the Autopsy carve-corruption precedent in project
// notes) -- "even bad translation" still has a floor, and infinite
// repetition is below it. Re-add once someone has time to either build a
// correct conversion (matching whatever Xenova's own, undocumented
// tokenizer.js conversion script actually does) or find/commission one.
export const AVAILABLE_LANGS = {
  ara: 'Arabic',
  chi_sim: 'Chinese (Simplified)',
  rus: 'Russian',
  tur: 'Turkish',
  fas: 'Farsi',
};

// mT5 (fas) needs no task prefix either -- confirmed against the source
// model's own README/example usage, which feeds it raw Persian text with
// no prepended format string. Kept as an explicit per-language config
// (rather than assuming every future language works the same way) since a
// future addition might genuinely need one.
const MODEL_CONFIG = {
  ara: { dir: modelDir('ara') },
  chi_sim: { dir: modelDir('chi_sim') },
  rus: { dir: modelDir('rus') },
  tur: { dir: modelDir('tur') },
  fas: { dir: modelDir('fas') },
};

function normalizeLang(lang) {
  if (!lang || !AVAILABLE_LANGS[lang]) {
    throw new Error(`translateText: unsupported or missing source language code: ${lang}`);
  }
  return lang;
}

// One cached pipeline per source language -- unlike ocr.js's per-
// combination worker keying, translation is always exactly one source
// language per call, so the cache key is just the language code.
const translatorPromises = new Map();

function getTranslator(lang) {
  if (!translatorPromises.has(lang)) {
    const { dir } = MODEL_CONFIG[lang];
    translatorPromises.set(
      lang,
      pipeline('translation', dir, { local_files_only: true, dtype: 'q8' })
    );
  }
  return translatorPromises.get(lang);
}

/**
 * Translates text from the given source language into English using a
 * local ONNX model (Marian for ara/chi_sim/rus/tur/ell, mT5 for fas) --
 * fully offline, no API key, same "ML-based but deterministic/local"
 * category as ocr.js's Tesseract OCR. Quality varies a lot by language and
 * is not a substitute for a human/professional translation -- this is
 * explicitly the "even bad machine translation beats nothing" tool.
 */
export async function translateText(text, sourceLang) {
  const lang = normalizeLang(sourceLang);
  if (!text) {
    return { text: '', meta: { translationEngine: 'transformers.js', sourceLang: lang, modelId: MODEL_CONFIG[lang].dir } };
  }

  const translator = await getTranslator(lang);
  const [result] = await translator(text);
  return {
    text: result?.translation_text ?? '',
    meta: { translationEngine: 'transformers.js', sourceLang: lang, modelId: MODEL_CONFIG[lang].dir },
  };
}
