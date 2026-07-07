import AdmZip from 'adm-zip';
import { looksLikeSupportedImage } from './ocr.js';

// classifyAttachment() (src/extract/index.js) only trusts mimeType and
// filename extension -- both fully attacker-controlled (a renamed/
// spoofed file goes straight to the "matching" extractor otherwise).
// This module inspects actual bytes instead, generalizing the
// magic-byte sniff ocr.js already does for images to docx/xlsx/pptx/pdf.

const PDF_MAGIC_ASCII = '%PDF-';
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// The marker entry each OOXML kind is expected to contain -- a plain ZIP
// signature alone doesn't distinguish a docx from an xlsx from an
// arbitrary renamed zip archive.
const OOXML_MARKER_ENTRY = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
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
  for (const [kind, marker] of Object.entries(OOXML_MARKER_ENTRY)) {
    if (entryNames.has(marker)) return kind;
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
