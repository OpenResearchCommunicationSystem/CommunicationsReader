import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkerFile, runSandboxedExtraction } from '../src/extract/sandboxed-extract.js';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const THROWING_WORKER = path.join(here, 'fixtures', 'sandbox-workers', 'throwing-worker.js');
const HANGING_WORKER = path.join(here, 'fixtures', 'sandbox-workers', 'hanging-worker.js');

test('runSandboxedExtraction: a real docx extracts successfully inside a worker thread', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalDocx('Sandboxed extraction test'), 'x.docx');
  try {
    const result = await runSandboxedExtraction('docx', filePath);
    assert.ok(result.text.includes('Sandboxed extraction test'));
  } finally {
    await cleanup();
  }
});

test('runWorkerFile: an uncaught exception inside the worker rejects the caller instead of crashing the process', async () => {
  await assert.rejects(() => runWorkerFile(THROWING_WORKER, {}, 5000));
});

test('runWorkerFile: a hung worker is terminated after the timeout', async () => {
  await assert.rejects(() => runWorkerFile(HANGING_WORKER, {}, 300), /timed out/);
});
