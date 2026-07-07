import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocx } from '../src/extract/docx.js';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('extractDocx pulls text out of a minimal .docx', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalDocx('Hello test document'), 'test.docx');
  try {
    const result = await extractDocx(filePath);
    assert.ok(result.text.includes('Hello test document'));
  } finally {
    await cleanup();
  }
});
