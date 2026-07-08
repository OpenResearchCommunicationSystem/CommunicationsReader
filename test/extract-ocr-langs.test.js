import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { extractImageOcr, terminateOcrWorker, AVAILABLE_LANGS, DEFAULT_LANGS } from '../src/extract/ocr.js';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// Regression coverage for the per-run language selection (S3 follow-up):
// OCR must be runnable against a caller-chosen language combination, not
// just the hardcoded eng+fas default, and each distinct combination gets
// its own cached worker keyed by the sorted language list (see ocr.js's
// getWorker()).

test('DEFAULT_LANGS and AVAILABLE_LANGS are consistent', () => {
  for (const lang of DEFAULT_LANGS) {
    assert.ok(AVAILABLE_LANGS[lang], `${lang} must be a known language`);
  }
});

test('extractImageOcr accepts a non-default language combination and caches its traineddata', async () => {
  const cacheDir = process.env.TESSDATA_CACHE_DIR || path.join(process.cwd(), '.tessdata-cache');
  const { filePath, cleanup } = await writeBufferToTemp(renderTextToPng('HELLO'), 'sample.png');
  try {
    const result = await extractImageOcr(filePath, ['eng', 'ara']);
    assert.ok(result.text.toUpperCase().includes('HELLO'));
    assert.deepEqual([...result.meta.ocrLangs].sort(), ['ara', 'eng']);
    assert.ok(existsSync(path.join(cacheDir, 'ara.traineddata.gz')), 'ara traineddata should have been cached locally');
  } finally {
    await cleanup();
  }
});

test('extractImageOcr rejects an unknown language code without touching the worker', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(renderTextToPng('HELLO'), 'sample.png');
  try {
    await assert.rejects(() => extractImageOcr(filePath, ['not-a-real-lang']), /unsupported language/);
  } finally {
    await cleanup();
  }
});

after(async () => {
  await terminateOcrWorker();
});
