import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractXlsx } from '../src/extract/xlsx.js';
import { buildMinimalXlsx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('extractXlsx pulls cell text out of a minimal .xlsx', async () => {
  const buffer = await buildMinimalXlsx('Hello test cell');
  const { filePath, cleanup } = await writeBufferToTemp(buffer, 'test.xlsx');
  try {
    const result = await extractXlsx(filePath);
    assert.ok(result.text.includes('Hello test cell'));
    assert.ok(result.text.includes('Second column'));
    assert.deepEqual(result.meta.sheetNames, ['Sheet1']);
  } finally {
    await cleanup();
  }
});
