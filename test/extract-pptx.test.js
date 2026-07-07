import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPptx } from '../src/extract/pptx.js';
import { buildMinimalPptx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('extractPptx pulls text runs out of a minimal .pptx', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalPptx('Hello test slide'), 'test.pptx');
  try {
    const result = extractPptx(filePath);
    assert.ok(result.text.includes('Hello test slide'));
    assert.equal(result.meta.slideCount, 1);
  } finally {
    await cleanup();
  }
});

test('extractPptx unescapes XML entities in text runs', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(
    buildMinimalPptx('Tom &amp; Jerry &lt;test&gt;'),
    'test.pptx'
  );
  try {
    const result = extractPptx(filePath);
    assert.ok(result.text.includes('Tom & Jerry <test>'));
  } finally {
    await cleanup();
  }
});
