import { classifyAttachment } from './index.js';
import { extractDocx } from './docx.js';
import { extractXlsx } from './xlsx.js';
import { extractPptx } from './pptx.js';
import { extractPdf } from './pdf.js';
import { extractImageOcr } from './ocr.js';

const EXTRACTORS = {
  docx: (savedPath) => extractDocx(savedPath),
  xlsx: (savedPath) => extractXlsx(savedPath),
  pptx: (savedPath) => extractPptx(savedPath),
  pdf: (savedPath) => extractPdf(savedPath),
  image: (savedPath) => extractImageOcr(savedPath),
};

/**
 * Given one attachment row ({ filename, mimeType, savedPath }), attempts
 * text extraction and returns the result -- never throws. An unsupported
 * type (legacy .doc/.xls/.ppt, video, audio, etc.) is a normal outcome,
 * not a failure: { status: 'not_attempted', method: null }. Any thrown
 * error from an extractor is caught and recorded as
 * { status: 'attempted_failed' } so one bad attachment never aborts a
 * batch (src/extract/run-extraction.js).
 */
export async function extractAttachmentText(attachment) {
  const kind = classifyAttachment(attachment);

  if (kind === 'unsupported') {
    return { status: 'not_attempted', method: null, text: null, error: null, meta: null };
  }

  const methodName = {
    docx: 'docx-mammoth',
    xlsx: 'xlsx-exceljs',
    pptx: 'pptx-handrolled',
    pdf: 'pdf-text-layer',
    image: 'image-ocr',
  }[kind];

  try {
    const { text, meta } = await EXTRACTORS[kind](attachment.savedPath);
    return { status: 'attempted_succeeded', method: methodName, text: text ?? '', error: null, meta: meta ?? null };
  } catch (err) {
    return { status: 'attempted_failed', method: methodName, text: null, error: err.message, meta: null };
  }
}
