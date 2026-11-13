import fs from 'node:fs';
import { ocrImageViaAi } from '../ai-assist/index.js';

// Curated, not exhaustive -- kept only as the UI's per-run language
// picker list; the AI vision model handles multilingual text natively
// and langs is no longer required to select a worker/model the way
// Tesseract needed it. Kept as a hint only: a chosen language isn't
// enforced, since the API doesn't need one, but the picker stays so an
// investigator can still note what they expect to see.
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

// Same sniff-before-trusting-the-claimed-type guard as before Tesseract
// was removed -- still worth doing even though an API call (not a local
// WASM worker) now does the reading: it's a cheap, free way to reject a
// null/missing path or a non-image file before spending an API call on
// it, and it tells us the mime type to send.
const MAGIC_SIGNATURES = [
  { format: 'jpeg', mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'bmp', mimeType: 'image/bmp', bytes: [0x42, 0x4d] },
  { format: 'tiff-le', mimeType: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { format: 'tiff-be', mimeType: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

// Exported for src/extract/magic-bytes.js, which generalizes this same
// sniff-before-trusting-the-claimed-type pattern to docx/xlsx/pptx/pdf.
export function looksLikeSupportedImage(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return true;
  }
  return MAGIC_SIGNATURES.some(({ bytes }) => bytes.every((b, i) => buf[i] === b));
}

function detectMimeType(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  const match = MAGIC_SIGNATURES.find(({ bytes }) => bytes.every((b, i) => buf[i] === b));
  return match?.mimeType ?? 'application/octet-stream';
}

/**
 * OCRs an image file (JPG/PNG/BMP/TIFF/WebP) via the investigator's
 * configured AI endpoint (see src/ai-assist/) -- replaces the previously
 * bundled Tesseract.js + per-language traineddata packages, per the
 * 2026-11 decision to trim anything replaceable by an API call. Throws a
 * clear, catchable error (never crashes the batch -- callers in
 * src/extract/index.js already wrap this) both on a real API failure and
 * when no AI endpoint is configured at all, so the latter shows up as an
 * ordinary "attempted_failed" extraction status explaining why, not a
 * silent gap.
 */
export async function extractImageOcr(savedPath) {
  if (!savedPath) {
    throw new Error('extractImageOcr: no file available (savedPath is empty)');
  }

  const buf = await fs.promises.readFile(savedPath);
  const head = buf.subarray(0, 16);
  if (!looksLikeSupportedImage(head)) {
    throw new Error(`extractImageOcr: ${savedPath} does not look like a supported image format`);
  }

  const result = await ocrImageViaAi(buf, detectMimeType(head));
  if (!result) {
    throw new Error('extractImageOcr: no AI endpoint configured (see ai-config.json in the case workspace folder)');
  }
  return result;
}

/**
 * No-op kept for call-site compatibility (src/extract/run-extraction.js
 * calls this once per batch) -- there's no long-lived worker to tear
 * down anymore, each OCR call is a stateless API request.
 */
export async function terminateOcrWorker() {}
