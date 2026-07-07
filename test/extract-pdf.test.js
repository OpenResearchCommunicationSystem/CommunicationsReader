import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPdf } from '../src/extract/pdf.js';
import { buildMinimalPdfWithText, buildMinimalPdfNoTextLayer } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('extractPdf pulls text out of a PDF with a real text layer', async () => {
  // Text long enough (20+ non-whitespace chars) to clear pdf.js's own
  // "has a real text layer" floor -- see TEXT_LAYER_MIN_CHARS in pdf.js.
  const sampleText = 'Hello PDF text layer with enough characters';
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalPdfWithText(sampleText), 'test.pdf');
  try {
    const result = await extractPdf(filePath);
    assert.ok(result.text.includes(sampleText));
    assert.equal(result.meta.pageCount, 1);
    assert.deepEqual(result.meta.pagesWithTextLayer, [1]);
    assert.equal(result.meta.note, undefined);
  } finally {
    await cleanup();
  }
});

test('extractPdf detects a page with no text layer (simulated scanned page)', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalPdfNoTextLayer(), 'test.pdf');
  try {
    const result = await extractPdf(filePath);
    assert.equal(result.text, '');
    assert.equal(result.meta.pageCount, 1);
    assert.deepEqual(result.meta.pagesWithTextLayer, []);
    assert.ok(result.meta.note.includes('no detected text layer'));
  } finally {
    await cleanup();
  }
});
