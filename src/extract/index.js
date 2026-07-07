import path from 'node:path';

const MIME_TO_KIND = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'image/webp': 'image',
};

const EXT_TO_KIND = {
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  '.pdf': 'pdf',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.bmp': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.webp': 'image',
};

/**
 * Classifies an attachment into an extraction "kind" by mimeType (primary
 * signal), falling back to filename extension when mimeType is missing or
 * generic (e.g. application/octet-stream). Legacy binary Office formats
 * (.doc/.xls/.ppt) and anything else (video, audio, archives, etc.)
 * resolve to 'unsupported' -- deliberately out of scope for this
 * milestone, not a bug.
 */
export function classifyAttachment({ mimeType, filename }) {
  if (mimeType && MIME_TO_KIND[mimeType]) return MIME_TO_KIND[mimeType];

  const ext = filename ? path.extname(filename).toLowerCase() : '';
  if (EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];

  return 'unsupported';
}
