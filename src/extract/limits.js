import AdmZip from 'adm-zip';
import './pdfjs-polyfills.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Named limits, checked after magic-byte verification and before any
// extractor runs. Values are conservative defaults for a resource-
// constrained, non-continuously-charged laptop -- tunable, not validated
// against a real corpus yet.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRY_COUNT = 5000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
export const MAX_PDF_PAGE_COUNT = 2000;

export class AttachmentLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttachmentLimitError';
  }
}

export function checkRawSize(size) {
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentLimitError(`attachment size ${size} bytes exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit`);
  }
}

// Entry count / declared uncompressed size checked from the zip's central
// directory metadata, without decompressing entry bodies -- a zip bomb
// guard for docx/xlsx/pptx, whose extractors (mammoth/exceljs/pptx.js)
// otherwise decompress unconditionally.
function checkZipStructure(buffer) {
  const entries = new AdmZip(buffer).getEntries();
  if (entries.length > MAX_ZIP_ENTRY_COUNT) {
    throw new AttachmentLimitError(`zip contains ${entries.length} entries, exceeding the ${MAX_ZIP_ENTRY_COUNT}-entry limit`);
  }
  const totalUncompressed = entries.reduce((sum, e) => sum + (e.header?.size ?? 0), 0);
  if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new AttachmentLimitError(
      `zip uncompressed size ${totalUncompressed} bytes exceeds the ${MAX_ZIP_UNCOMPRESSED_BYTES}-byte limit (possible zip bomb)`
    );
  }
}

async function checkPdfPageCount(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    if (doc.numPages > MAX_PDF_PAGE_COUNT) {
      throw new AttachmentLimitError(`pdf has ${doc.numPages} pages, exceeding the ${MAX_PDF_PAGE_COUNT}-page limit`);
    }
  } finally {
    // This pdfjs-dist build's PDFDocumentProxy has no destroy() -- confirmed
    // directly against the installed version -- only cleanup().
    await doc.cleanup();
  }
}

/**
 * Structural/complexity limits beyond the raw-size cap. docx/xlsx/pptx:
 * zip-bomb guard. pdf: pathological page count, checked via pdfjs-dist
 * metadata only (no per-page parse -- that's the real extractor's job,
 * see src/extract/pdf.js). image has no structural check here.
 */
export async function checkStructuralLimits(kind, buffer) {
  if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
    checkZipStructure(buffer);
  } else if (kind === 'pdf') {
    await checkPdfPageCount(buffer);
  }
}
