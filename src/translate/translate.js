import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Shared with modelDir() and onnxRuntimeBinDir() below -- both compute a
// path under the project root that may or may not be inside a packed
// asar. Confirmed a real packaging bug here (same SHAPE as the one
// ocr.js's TESSDATA_CACHE_DIR comment describes, hit again despite that
// precedent): Electron's fs shim only redirects app.asar/... reads to the
// real app.asar.unpacked/... location for calls that go through Node's
// own fs module, which it monkey-patches -- native code that opens files
// via the OS's file APIs directly (onnxruntime-node's addon, both for the
// .onnx weights and for its own sibling DLLs) bypasses that patch
// entirely, so a path computed as if still inside the asar fails even
// though asarUnpack genuinely copied the file to a real location on disk.
// Confirmed via ELECTRON_RUN_AS_NODE against an actual packaged build, not
// assumed from working in dev. Fix: rewrite the computed path's app.asar
// segment to app.asar.unpacked explicitly -- a no-op when not running
// from inside a packed asar (dev, tests, the CLI).
function toUnpacked(dir) {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
  return dir.includes(asarSegment) ? dir.split(asarSegment).join(unpackedSegment) : dir;
}

// Bundled ONNX weights live in models/translation/<code>/ (see
// scripts/fetch-translation-models.mjs), asarUnpack'd in package.json the
// same way tesseract.js-core is.
function modelDir(code) {
  return toUnpacked(path.join(here, '..', '..', 'models', 'translation', code));
}

// onnxruntime-node's native addon (onnxruntime_binding.node) links against
// sibling DLLs in its own bin/napi-v6/win32/<arch>/ folder (onnxruntime.dll,
// DirectML.dll, dxcompiler.dll, dxil.dll). Confirmed against an actual
// packaged portable build: Electron's main process fails to load the addon
// with "The specified module could not be found" pointing at
// onnxruntime_binding.node itself, even though every one of those DLLs is
// genuinely sitting right next to it on disk (verified byte-for-byte) --
// plain `node -e "require(...)"` against the exact same packaged path
// loads it successfully outside Electron. The difference is Electron's
// native-module loader on Windows, unlike a plain Node process, doesn't
// search a loaded addon's own directory for its dependent DLLs. Prepending
// that directory to PATH restores the fallback search Windows still does
// honor. Must happen before @huggingface/transformers is ever imported
// (it requires onnxruntime-node eagerly at its own module-load time), which
// is why the import below is dynamic instead of static -- a static import
// gets hoisted and evaluated before any of this file's own top-level code
// could run, defeating the PATH prepend entirely.
function onnxRuntimeBinDir() {
  return toUnpacked(
    path.join(here, '..', '..', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', process.arch)
  );
}

let onnxRuntimePathPatched = false;
function ensureOnnxRuntimeOnPath() {
  if (process.platform !== 'win32' || onnxRuntimePathPatched) return;
  onnxRuntimePathPatched = true;
  process.env.PATH = `${onnxRuntimeBinDir()}${path.delimiter}${process.env.PATH ?? ''}`;
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
    // IIFE so the promise is stored in the map synchronously, before the
    // dynamic import below resolves -- otherwise two concurrent calls for
    // the same lang would race past the `.has()` check above and each
    // start their own pipeline load.
    translatorPromises.set(
      lang,
      (async () => {
        ensureOnnxRuntimeOnPath();
        const { pipeline, env: transformersEnv } = await import('@huggingface/transformers');
        // Zero-network guarantee, mirroring src/extract/ocr.js's langPath
        // comment. Verified by reading @huggingface/transformers' own
        // source (src/utils/hub.js): when env.allowRemoteModels is false,
        // getModelFile() throws synchronously ("env.allowRemoteModels=false,
        // but attempted to load a remote file...") instead of ever falling
        // back to a network fetch -- not a silent fallback, a hard error.
        // local_files_only is also passed per-call below as defense in
        // depth, same belt-and-suspenders spirit as the rest of this
        // module.
        transformersEnv.allowRemoteModels = false;
        const { dir } = MODEL_CONFIG[lang];
        return pipeline('translation', dir, { local_files_only: true, dtype: 'q8' });
      })()
    );
  }
  return translatorPromises.get(lang);
}

// --- Sentence segmentation --------------------------------------------
// Marian/OPUS-MT's own documentation recommends translating one sentence
// at a time -- these models are trained on sentence-aligned parallel
// corpora, so a multi-sentence paragraph is already somewhat out of
// distribution even after the paragraph-level splitting above. Sentence-
// ending punctuation differs by script: CJK uses full-width 。！？ with no
// following space; Arabic/Farsi use ؟ (U+061F) alongside the Latin . and
// !; Russian/Turkish use ordinary Latin punctuation. This is a plain
// regex splitter, not a proper sentence-boundary model (no abbreviation
// handling) -- research on this consistently finds even a naive
// segmenter beats no segmentation at all, and a heavier NLP dependency
// isn't worth it for this project's portable-packaging constraints.
const SENTENCE_SPLIT_RE = {
  chi_sim: /(?<=[。！？])/,
  ara: /(?<=[؟!.])\s*/,
  fas: /(?<=[؟!.])\s*/,
};
const DEFAULT_SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

function splitSentences(paragraph, lang) {
  const re = SENTENCE_SPLIT_RE[lang] ?? DEFAULT_SENTENCE_SPLIT_RE;
  return paragraph.split(re).map((s) => s.trim()).filter(Boolean);
}

// --- Numeric/reference-code masking: TRIED AND REJECTED -------------------
// The decades-old CAT-tool technique (memoQ's "non-translatable" spans,
// Wordfast's "placeables") -- mask numbers/codes behind a placeholder
// token before translation, restore the original source text afterward --
// was implemented here and then reverted after measuring its actual
// effect. It made output WORSE, not better: this off-the-shelf Marian
// pipeline has no special-token support telling it a placeholder like
// "NUMONE" is an opaque, untranslatable unit, so it just tokenizes and
// "translates" the placeholder like any other word, producing things
// like "US$ 0.OMOTO" and "US$20.023 million" -- confirmed against this
// project's own language-test dataset. That's a worse failure mode than
// the plain digit corruption it was meant to fix (9,200 -> 90,000): a
// fabricated-looking number is more dangerous to an investigator than an
// obviously-broken one. Real production placeholder systems rely on
// word-alignment/attention weights (or a tokenizer with the placeholder
// registered as a real special token) to know which output span
// corresponds to which input placeholder -- neither is readily available
// through transformers.js's plain pipeline() API, so this technique
// doesn't transfer here without deeper model-level changes. Sentence-
// level splitting alone (above) already fixed the numbers that matter
// most in practice ($8,500, $150,000, 35%, $4.35/share all came back
// exactly correct in the same test letter); what's left --minor rounding
// drift and CJK multiplier words like 万 (x10,000) converting inaccurately
// -- has no software fix here. Investigators must cross-check any
// translated figure against the original text; this tool does not
// guarantee numeric fidelity.
//
// Worse still: this isn't purely a long-input or chunk-size problem.
// Confirmed against a single short isolated sentence with no surrounding
// context at all ("价格是8,500美元。", nothing else) -- "$8,500" came back
// as "ki-da", a complete fabrication with no numeral in it whatsoever.
// Since even an untouched, unmasked, isolated number can be destroyed,
// no chunking or masking strategy can fully solve this -- it's a
// reliability property of the model itself. The only thing left to do
// is detect and flag it after the fact rather than try to prevent it.

// --- Numeric/reference-code detection (for post-hoc verification) --------
// Since translation can't be trusted to preserve these spans, extract
// them from the ORIGINAL (untouched, guaranteed-correct) source text and
// hand them back in meta so the UI can show the investigator a "these are
// the real figures -- check the translation against them" list, and flag
// any one of them that doesn't appear verbatim anywhere in the translated
// output as a strong, high-confidence "this may have been mistranslated"
// signal. Same regexes the (reverted) masking attempt used -- they were
// never the problem, using them to intervene in translation was.
const REFERENCE_CODE_RE = /\b[A-Z]{2,6}-[A-Z0-9-]+\b/g;
const NUMERIC_SPAN_RE = /(?<![A-Za-z])\$?\d[\d,]*(?:\.\d+)?%?/g;

function extractNumericSpans(text) {
  const codes = [...new Set([...text.matchAll(REFERENCE_CODE_RE)].map((m) => m[0]))];
  const numbers = [...new Set([...text.matchAll(NUMERIC_SPAN_RE)].map((m) => m[0]))]
    // Drop a bare number that's already contained in a captured reference
    // code (e.g. "77341" inside "INV-77341") -- same figure, would
    // otherwise show up twice in the investigator-facing checklist.
    .filter((num) => !codes.some((code) => code.includes(num)));
  return [...codes, ...numbers];
}

/**
 * Translates text from the given source language into English using a
 * local ONNX model (Marian for ara/chi_sim/rus/tur/ell, mT5 for fas) --
 * fully offline, no API key, same "ML-based but deterministic/local"
 * category as ocr.js's Tesseract OCR. Quality varies a lot by language and
 * is not a substitute for a human/professional translation -- this is
 * explicitly the "even bad machine translation beats nothing" tool.
 *
 * Pipeline: split on paragraph breaks, then sentences within each
 * paragraph (see splitSentences() above for why), translating each
 * sentence individually. Confirmed necessary against a real ~350-word
 * 4-paragraph Chinese business letter
 * (sample-data/dummy-dataset-language-test-1.zip's own "LONG" tier): fed
 * whole with no chunking at all, the model merged the last two
 * paragraphs into one incoherent sentence, dropping an entire equity-deal
 * paragraph's figures and mangling embedded English terms ("Charter
 * Party" -> gibberish, "Due Diligence" -> gone entirely) -- these models
 * silently degrade past their training distribution rather than erroring,
 * so there's no failure signal short of checking real output.
 *
 * meta.sourceNumericSpans / meta.numericSpansMissingInTranslation (see
 * extractNumericSpans() above) let the UI show the investigator which
 * numbers/codes from the ORIGINAL text to manually verify, and flag any
 * that don't survive into the translation at all -- since, per the
 * comment above, translation cannot be trusted to preserve these itself.
 */
export async function translateText(text, sourceLang) {
  const lang = normalizeLang(sourceLang);
  const meta = { translationEngine: 'transformers.js', sourceLang: lang, modelId: MODEL_CONFIG[lang].dir };
  if (!text) {
    return { text: '', meta };
  }

  const translator = await getTranslator(lang);

  async function translateSentence(sentence) {
    if (!sentence.trim()) return '';
    const [result] = await translator(sentence);
    return result?.translation_text ?? '';
  }

  const paragraphs = text.split(/\n\s*\n/);
  const translatedParagraphs = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      translatedParagraphs.push('');
      continue;
    }
    const sentences = splitSentences(para, lang);
    const translatedSentences = [];
    for (const sentence of sentences) {
      translatedSentences.push(await translateSentence(sentence));
    }
    translatedParagraphs.push(translatedSentences.join(' '));
  }
  const translatedText = translatedParagraphs.join('\n\n');

  const sourceNumericSpans = extractNumericSpans(text);
  meta.sourceNumericSpans = sourceNumericSpans;
  meta.numericSpansMissingInTranslation = sourceNumericSpans.filter((span) => !translatedText.includes(span));

  return { text: translatedText, meta };
}
