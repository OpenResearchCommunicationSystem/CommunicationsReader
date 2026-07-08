import AdmZip from 'adm-zip';
import { looksLikeSupportedImage } from './ocr.js';

// classifyAttachment() (src/extract/index.js) only trusts mimeType and
// filename extension -- both fully attacker-controlled (a renamed/
// spoofed file goes straight to the "matching" extractor otherwise).
// This module inspects actual bytes instead, generalizing the
// magic-byte sniff ocr.js already does for images to docx/xlsx/pptx/pdf.

const PDF_MAGIC_ASCII = '%PDF-';
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// A marker each OOXML kind is expected to contain -- a plain ZIP
// signature alone doesn't distinguish a docx from an xlsx from an
// arbitrary renamed zip archive. pptx checks for a slide entry (what
// src/extract/pptx.js itself actually consumes) rather than requiring
// ppt/presentation.xml, since that's the real signal this codebase's own
// extractor depends on.
const SLIDE_ENTRY_RE = /^ppt\/slides\/slide\d+\.xml$/;
const OOXML_KIND_MATCHERS = {
  docx: (entryNames) => entryNames.has('word/document.xml'),
  xlsx: (entryNames) => entryNames.has('xl/workbook.xml'),
  pptx: (entryNames) => entryNames.has('ppt/presentation.xml') || [...entryNames].some((n) => SLIDE_ENTRY_RE.test(n)),
};

function startsWithBytes(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function detectOoxmlKind(buffer) {
  let entryNames;
  try {
    entryNames = new Set(new AdmZip(buffer).getEntries().map((e) => e.entryName));
  } catch {
    return 'zip-unknown';
  }
  for (const [kind, matches] of Object.entries(OOXML_KIND_MATCHERS)) {
    if (matches(entryNames)) return kind;
  }
  return 'zip-unknown';
}

function detectKind(buffer) {
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === PDF_MAGIC_ASCII) {
    return 'pdf';
  }
  if (looksLikeSupportedImage(buffer)) {
    return 'image';
  }
  if (startsWithBytes(buffer, ZIP_MAGIC)) {
    return detectOoxmlKind(buffer);
  }
  return 'unknown';
}

/**
 * Verifies that a buffer's actual content matches its claimed extraction
 * kind (from classifyAttachment(), which is based on attacker-controlled
 * mimeType/filename). Returns { verifiedKind, mismatch }. Callers must
 * treat mismatch as an outright rejection -- never "attempt anyway".
 */
export function verifyAttachmentKind(buffer, claimedKind) {
  const verifiedKind = detectKind(buffer);
  return { verifiedKind, mismatch: verifiedKind !== claimedKind };
}
