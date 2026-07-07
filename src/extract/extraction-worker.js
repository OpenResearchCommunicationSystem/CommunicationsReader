import { parentPort, workerData } from 'node:worker_threads';
import { extractDocx } from './docx.js';
import { extractXlsx } from './xlsx.js';
import { extractPptx } from './pptx.js';
import { extractPdf } from './pdf.js';

const EXTRACTORS = {
  docx: (savedPath) => extractDocx(savedPath),
  xlsx: (savedPath) => extractXlsx(savedPath),
  pptx: (savedPath) => extractPptx(savedPath),
  pdf: (savedPath) => extractPdf(savedPath),
};

// Runs entirely inside an isolated worker_thread spawned by
// sandboxed-extract.js. An uncaught exception or an unresponsive hang
// here surfaces to the parent as a Worker 'error' event or a timeout,
// instead of crashing (or wedging) the whole app -- the entire point of
// routing docx/xlsx/pptx/pdf extraction through here rather than calling
// these library-backed extractors in-process. image/OCR deliberately
// does NOT go through this worker; see ocr.js and sandboxed-extract.js.
async function run() {
  const { kind, savedPath } = workerData;
  const extractor = EXTRACTORS[kind];
  if (!extractor) {
    parentPort.postMessage({ ok: false, error: `no sandboxed extractor for kind "${kind}"` });
    return;
  }
  try {
    const result = await extractor(savedPath);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
}

run();
