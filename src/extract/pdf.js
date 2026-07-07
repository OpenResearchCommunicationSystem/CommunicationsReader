import { readFile } from 'node:fs/promises';
import './pdfjs-polyfills.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// A page counts as "has a real text layer" if it has at least this many
// non-whitespace characters -- a floor that avoids treating a single
// stray text object (e.g. a page-number stamp) on an otherwise-scanned
// page as a real text layer. Tunable; not validated against a real
// corpus yet.
const TEXT_LAYER_MIN_CHARS = 20;

// Rasterizing a page to pixels for OCR would require a canvas
// implementation, which in Node means either @napi-rs/canvas or `canvas`
// -- both native bindings, exactly the kind of dependency this project
// has already avoided elsewhere (node:sqlite over better-sqlite3) for
// portable-exe packaging reasons. So: PDF pages with no text layer are
// recorded as such (extractedText: '', noted in meta) rather than OCR'd.
// True image attachments (JPG/PNG/etc.) still go through ocr.js normally
// -- only *rasterizing a PDF page* is deferred.
export async function extractPdf(savedPath) {
  const data = await readFile(savedPath);

  const doc = await getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pageCount = doc.numPages;
  const pagesWithTextLayer = [];
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ');
    const nonWhitespaceCount = text.replace(/\s/g, '').length;

    if (nonWhitespaceCount >= TEXT_LAYER_MIN_CHARS) {
      pagesWithTextLayer.push(pageNum);
      pageTexts.push(text);
    }
  }

  const meta = {
    pageCount,
    pagesWithTextLayer,
    pagesOcrd: [],
  };
  if (pagesWithTextLayer.length < pageCount) {
    meta.note = 'one or more pages had no detected text layer; PDF-page OCR is not implemented in this milestone';
  }

  return { text: pageTexts.join('\n\n'), meta };
}
