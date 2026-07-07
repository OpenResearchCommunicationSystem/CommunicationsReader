import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { extractImageOcr, terminateOcrWorker } from '../src/extract/ocr.js';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// Real end-to-end OCR (via a hand-rolled bitmap-font PNG, not a mocked
// Tesseract) -- deliberately not gated behind an opt-in env var, since
// this is the single highest-risk part of the whole milestone (the
// project's hard "no network calls" constraint) and running it for real
// on every test run is the only way to actually prove Tesseract never
// reaches out to a CDN for its worker/core/traineddata.
test('extractImageOcr reads real text from a generated image, using only local traineddata', async () => {
  const png = renderTextToPng('HELLO');
  const { filePath, cleanup } = await writeBufferToTemp(png, 'sample.png');
  try {
    const result = await extractImageOcr(filePath);
    assert.ok(result.text.toUpperCase().includes('HELLO'));
    assert.equal(result.meta.ocrEngine, 'tesseract.js');
    assert.equal(typeof result.meta.ocrConfidenceMean, 'number');
  } finally {
    await cleanup();
  }
});

after(async () => {
  await terminateOcrWorker();
});
