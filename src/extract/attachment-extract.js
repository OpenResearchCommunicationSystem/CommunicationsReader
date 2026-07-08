import { readFile } from 'node:fs/promises';
import { classifyAttachment } from './index.js';
import { extractImageOcr } from './ocr.js';
import { verifyAttachmentKind } from './magic-bytes.js';
import { checkRawSize, checkStructuralLimits, AttachmentLimitError } from './limits.js';
import { runSandboxedExtraction } from './sandboxed-extract.js';

// docx/xlsx/pptx/pdf run inside an isolated worker_thread (see
// sandboxed-extract.js). image/OCR is deliberately excluded -- ocr.js
// already has its own crash-guard and a persistent shared worker reused
// across a whole batch; see sandboxed-extract.js's own comment.
const SANDBOXED_KINDS = new Set(['docx', 'xlsx', 'pptx', 'pdf']);

const METHOD_NAME = {
  docx: 'docx-mammoth',
  xlsx: 'xlsx-exceljs',
  pptx: 'pptx-handrolled',
  pdf: 'pdf-text-layer',
  image: 'image-ocr',
};

/**
 * Given one attachment row ({ filename, mimeType, savedPath }), attempts
 * text extraction and returns the result -- never throws. An unsupported
 * type (legacy .doc/.xls/.ppt, video, audio, etc.) is a normal outcome,
 * not a failure: { status: 'not_attempted', method: null }.
 *
 * Before any extractor runs, verifies the file's actual bytes match its
 * claimed kind (classifyAttachment() only trusts mimeType/filename, both
 * attacker-controlled) and checks size/complexity limits. A mismatch or
 * limit violation is recorded as a quarantine rejection and the
 * attachment NEVER reaches an extractor -- extractionStatus stays
 * 'not_attempted' for it, matching the documented invariant in
 * src/db/schema.js. Any other thrown error (extraction itself, or a
 * verification step that couldn't run at all, e.g. an unreadable file)
 * is caught and recorded as { status: 'attempted_failed' } so one bad
 * attachment never aborts a batch (src/extract/run-extraction.js).
 *
 * Result also carries quarantineStatus/quarantineReason -- a lifecycle
 * separate from extractionStatus, see src/db/schema.js's attachments
 * table comment for the full state meanings.
 *
 * options.langs: which Tesseract languages to recognize an image against
 * (see ocr.js's AVAILABLE_LANGS) -- ignored for non-image kinds. Defaults
 * to ocr.js's own DEFAULT_LANGS when omitted.
 */
export async function extractAttachmentText(attachment, options = {}) {
  const kind = classifyAttachment(attachment);

  if (kind === 'unsupported') {
    return { status: 'not_attempted', method: null, text: null, error: null, meta: null, quarantineStatus: null, quarantineReason: null };
  }

  const methodName = METHOD_NAME[kind];

  let buffer;
  try {
    buffer = await readFile(attachment.savedPath);
  } catch (err) {
    return {
      status: 'attempted_failed',
      method: methodName,
      text: null,
      error: err.message,
      meta: null,
      quarantineStatus: 'error',
      quarantineReason: `could not read file for verification: ${err.message}`,
    };
  }

  const { mismatch, verifiedKind } = verifyAttachmentKind(buffer, kind);
  if (mismatch) {
    return {
      status: 'not_attempted',
      method: null,
      text: null,
      error: null,
      meta: null,
      quarantineStatus: 'rejected',
      quarantineReason: `claimed kind "${kind}" does not match verified content (looks like "${verifiedKind}")`,
    };
  }

  try {
    checkRawSize(buffer.length);
    await checkStructuralLimits(kind, buffer);
  } catch (err) {
    if (err instanceof AttachmentLimitError) {
      return {
        status: 'not_attempted',
        method: null,
        text: null,
        error: null,
        meta: null,
        quarantineStatus: 'rejected',
        quarantineReason: err.message,
      };
    }
    return {
      status: 'attempted_failed',
      method: methodName,
      text: null,
      error: err.message,
      meta: null,
      quarantineStatus: 'error',
      quarantineReason: `limit check failed: ${err.message}`,
    };
  }

  try {
    const { text, meta } = SANDBOXED_KINDS.has(kind)
      ? await runSandboxedExtraction(kind, attachment.savedPath)
      : await extractImageOcr(attachment.savedPath, options.langs);
    return {
      status: 'attempted_succeeded',
      method: methodName,
      text: text ?? '',
      error: null,
      meta: meta ?? null,
      quarantineStatus: 'verified',
      quarantineReason: null,
    };
  } catch (err) {
    return {
      status: 'attempted_failed',
      method: methodName,
      text: null,
      error: err.message,
      meta: null,
      quarantineStatus: 'verified',
      quarantineReason: null,
    };
  }
}
