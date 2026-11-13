import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// AI-API-backed since the 2026-11 switch away from bundled Tesseract
// (see src/extract/ocr.js) -- mocked at the ai-assist boundary, same
// spirit as test/translate.test.js. This exercises ocr.js's own logic
// (magic-byte sniffing before ever calling out, mime-type detection, the
// "no endpoint configured" error path) rather than real OCR quality,
// which depends on whichever endpoint the investigator configures.
let lastCall = null;
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    ocrImageViaAi: async (buf, mimeType) => {
      lastCall = { mimeType, byteLength: buf.length };
      return { text: 'HELLO', meta: { ocrEngine: 'ai:mock:test', ocrConfidenceMean: null } };
    },
  },
});

const { extractImageOcr } = await import('../src/extract/ocr.js');

test('extractImageOcr sniffs the real image format and delegates to the configured AI endpoint', async () => {
  const png = renderTextToPng('HELLO');
  const { filePath, cleanup } = await writeBufferToTemp(png, 'sample.png');
  try {
    const result = await extractImageOcr(filePath);
    assert.equal(result.text, 'HELLO');
    assert.equal(result.meta.ocrEngine, 'ai:mock:test');
    assert.equal(lastCall.mimeType, 'image/png');
    assert.ok(lastCall.byteLength > 0);
  } finally {
    await cleanup();
  }
});

test('extractImageOcr rejects a file that does not look like a supported image before calling the AI endpoint', async () => {
  lastCall = null;
  const { filePath, cleanup } = await writeBufferToTemp(Buffer.from('not an image'), 'fake.png');
  try {
    await assert.rejects(() => extractImageOcr(filePath), /does not look like a supported image format/);
    assert.equal(lastCall, null, 'should never have called the AI endpoint for a non-image file');
  } finally {
    await cleanup();
  }
});
