import { createWorker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// tesseract.js-data ships each language's traineddata in its own package
// directory, but tesseract.js's language loader takes one shared langPath
// for all requested languages in a single call. Merge whichever languages
// are requested into one local cache directory -- a pure local file copy,
// never a network operation -- so they can be loaded together. This is the
// ONLY path that actually matters for the "zero network calls" guarantee:
// verified by reading tesseract.js's own source that on Node, the WASM
// core is require()'d directly from the installed tesseract.js-core
// package (corePath is a browser-only concern), and the CDN fallback in
// its language loader only triggers when langPath is left unset.
//
// Defaults to a path next to this module, which is fine when running
// from source (dev, tests, the CLI). Once packaged into an Electron app,
// this file ships inside a read-only asar archive, so a real writable
// directory doesn't exist next to it -- electron/main.js sets
// TESSDATA_CACHE_DIR to somewhere under app.getPath('userData') before
// any extraction runs.
//
// Deliberately NOT resolved at module load time: main.js statically
// imports this module (transitively, via run-extraction.js) at the top
// of the file, which runs before app.whenReady() has a chance to set
// TESSDATA_CACHE_DIR -- a module-level `const` here would permanently
// lock in the wrong fallback path. Resolving it lazily, inside the
// function that's only ever called after the app (and therefore
// TESSDATA_CACHE_DIR) is ready, avoids that trap.
function getMergedLangDir() {
  return process.env.TESSDATA_CACHE_DIR || path.join(here, '..', '..', '.tessdata-cache');
}

// Curated, not exhaustive: Tesseract itself supports 100+ languages, but
// loading many at once measurably slows recognition and increases
// misreads between visually similar scripts, so this app deliberately
// bundles a working set (matched to scripts actually seen in this
// project's test data and plausible casework) rather than "all of them,
// always on." Callers choose a subset per OCR run (see run-extraction.js's
// `langs` option) instead of every image always being recognized against
// every bundled language. Adding a language here requires installing its
// @tesseract.js-data/<code> package (see package.json).
export const AVAILABLE_LANGS = {
  eng: 'English',
  fas: 'Farsi',
  ara: 'Arabic',
  chi_sim: 'Chinese (Simplified)',
  rus: 'Russian',
  spa: 'Spanish',
  tur: 'Turkish',
  ell: 'Greek',
};

export const DEFAULT_LANGS = ['eng', 'fas'];
const OEM_LSTM_ONLY = 1;

function normalizeLangs(langs) {
  const list = Array.isArray(langs) && langs.length > 0 ? langs : DEFAULT_LANGS;
  const unknown = list.filter((l) => !AVAILABLE_LANGS[l]);
  if (unknown.length > 0) {
    throw new Error(`extractImageOcr: unsupported language code(s): ${unknown.join(', ')}`);
  }
  return list;
}

function langsCacheKey(langs) {
  return [...langs].sort().join('+');
}

function ensureMergedLangPath(langs) {
  const mergedLangDir = getMergedLangDir();
  fs.mkdirSync(mergedLangDir, { recursive: true });
  for (const lang of langs) {
    const { langPath } = require(`@tesseract.js-data/${lang}`);
    const src = path.join(langPath, `${lang}.traineddata.gz`);
    const dest = path.join(mergedLangDir, `${lang}.traineddata.gz`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
  return mergedLangDir;
}

// Keyed by the requested language combination -- e.g. a dataset OCR'd
// with just ['ara'] and another with ['eng', 'fas'] each get their own
// long-lived worker, since tesseract.js takes its language list at
// worker-creation time, not per recognize() call. WASM instantiation is
// expensive, so a given combination's worker is created once and reused
// across a whole batch (run-extraction.js's driver), never per image.
const workerPromises = new Map();

function getWorker(langs) {
  const key = langsCacheKey(langs);
  if (!workerPromises.has(key)) {
    const langPath = ensureMergedLangPath(langs);
    workerPromises.set(
      key,
      createWorker(langs, OEM_LSTM_ONLY, {
        langPath,
        cachePath: langPath,
        gzip: true,
      })
    );
  }
  return workerPromises.get(key);
}

// Confirmed empirically: tesseract.js's Node worker does NOT reliably
// reject recognize()'s promise on a bad/corrupt image -- a null path, a
// missing file, or a non-image file crashes the WHOLE Node process via an
// unhandled 'error' event on the underlying worker_thread, bypassing any
// try/catch around the call entirely (worker.onerror only wires up the
// worker's initial startup promise, not later recognize() calls). Two
// layers of defense, since a header-valid-but-corrupt image can still
// reach the crash path even after the format check below:
//   1. Sniff the file's magic bytes before ever handing it to tesseract --
//      catches null/missing paths and non-image files cheaply, without
//      invoking OCR at all.
//   2. Wrap the recognize() call with a scoped, temporary
//      uncaughtException listener that converts an escaped worker crash
//      into a normal rejected promise. This is unusual for this codebase
//      (which otherwise avoids anything this defensive-feeling) but is
//      the only way to uphold "one bad attachment never crashes the
//      batch" given this specific, verified upstream library gap.
const MAGIC_SIGNATURES = [
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'bmp', bytes: [0x42, 0x4d] },
  { format: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { format: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

// Exported for src/extract/magic-bytes.js, which generalizes this same
// sniff-before-trusting-the-claimed-type pattern to docx/xlsx/pptx/pdf.
export function looksLikeSupportedImage(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return true;
  }
  return MAGIC_SIGNATURES.some(({ bytes }) => bytes.every((b, i) => buf[i] === b));
}

function runRecognizeWithCrashGuard(worker, savedPath) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onUncaught = (err) => {
      if (settled) return;
      settled = true;
      process.off('uncaughtException', onUncaught);
      reject(new Error(`tesseract.js worker crashed during recognize(): ${err.message}`));
    };
    process.on('uncaughtException', onUncaught);

    worker
      .recognize(savedPath)
      .then((result) => {
        if (settled) return;
        settled = true;
        process.off('uncaughtException', onUncaught);
        resolve(result);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        process.off('uncaughtException', onUncaught);
        reject(err);
      });
  });
}

/**
 * OCRs an image file (JPG/PNG/BMP/TIFF/WebP) using a single long-lived
 * Tesseract worker for the given language combination (defaults to
 * English + Farsi). Never call createWorker per image -- WASM
 * instantiation is expensive; run-extraction.js's batch driver reuses one
 * worker per language combination across a whole batch via getWorker()'s
 * caching.
 */
export async function extractImageOcr(savedPath, langs) {
  if (!savedPath) {
    throw new Error('extractImageOcr: no file available (savedPath is empty)');
  }
  const resolvedLangs = normalizeLangs(langs);

  const head = Buffer.alloc(16);
  const fh = await fs.promises.open(savedPath, 'r');
  try {
    await fh.read(head, 0, 16, 0);
  } finally {
    await fh.close();
  }
  if (!looksLikeSupportedImage(head)) {
    throw new Error(`extractImageOcr: ${savedPath} does not look like a supported image format`);
  }

  const worker = await getWorker(resolvedLangs);
  const { data } = await runRecognizeWithCrashGuard(worker, savedPath);
  return {
    text: data.text ?? '',
    meta: { ocrEngine: 'tesseract.js', ocrLangs: resolvedLangs, ocrConfidenceMean: data.confidence ?? null },
  };
}

/**
 * Terminates every cached worker (one per distinct language combination
 * used this run) so the process can exit cleanly. Call once at the end of
 * a batch run.
 */
export async function terminateOcrWorker() {
  const pending = [...workerPromises.values()];
  workerPromises.clear();
  for (const workerPromise of pending) {
    const worker = await workerPromise;
    await worker.terminate();
  }
}
