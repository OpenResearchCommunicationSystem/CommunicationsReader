import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, existsSync } from 'node:fs';
import { extractImageOcr, terminateOcrWorker } from '../src/extract/ocr.js';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// Regression coverage for a real bug found via hands-on testing of the
// packaged app: electron/main.js sets process.env.TESSDATA_CACHE_DIR
// inside app.whenReady() (well after its own top-level imports have
// already run), but ocr.js originally read that env var into a
// module-level `const` -- which JS evaluates at import time, permanently
// locking in the wrong fallback path before main.js ever got a chance to
// set the real one. Every OCR call failed as a result ("Conversion
// failed" in the UI), while every other extractor (docx/xlsx/pptx/pdf)
// worked fine, since none of them have this "read an env var set later
// by main.js" pattern. This test imports ocr.js first (as this file's
// own top-level import already does, mirroring main.js's real order),
// THEN sets the env var, THEN calls extractImageOcr -- exactly the
// sequence that broke before the fix.

test('OCR uses TESSDATA_CACHE_DIR even when the env var is set after ocr.js was already imported', async () => {
  const fakeUserData = mkdtempSync(path.join(os.tmpdir(), 'ocr-cache-timing-'));
  const cacheDir = path.join(fakeUserData, 'tessdata-cache');
  process.env.TESSDATA_CACHE_DIR = cacheDir;

  const { filePath, cleanup } = await writeBufferToTemp(renderTextToPng('HELLO'), 'sample.png');
  try {
    const result = await extractImageOcr(filePath);
    assert.ok(result.text.toUpperCase().includes('HELLO'));
    assert.ok(existsSync(path.join(cacheDir, 'eng.traineddata.gz')), 'traineddata should be cached at TESSDATA_CACHE_DIR, not the module-relative fallback');
  } finally {
    await cleanup();
    delete process.env.TESSDATA_CACHE_DIR;
  }
});

after(async () => {
  await terminateOcrWorker();
});
