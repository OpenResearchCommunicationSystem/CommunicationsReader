import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extractImageOcr, terminateOcrWorker } from '../src/extract/ocr.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const childScript = path.join(projectRoot, 'test', 'fixtures', 'ocr-crash-guard-child.mjs');

// Regression coverage for a verified real bug: tesseract.js's Node worker
// does not reliably reject recognize()'s promise on a bad image -- a
// null/missing path, or a non-image file, crashed the whole Node process
// via an unhandled 'error' event on the underlying worker_thread,
// bypassing any try/catch (discovered while validating Milestone 4
// against real attachments where a null savedPath reached the OCR path).
// extractImageOcr must reject cleanly, never crash the process, in every
// case below.

test('extractImageOcr rejects (never crashes) on a null savedPath', async () => {
  await assert.rejects(() => extractImageOcr(null));
});

test('extractImageOcr rejects (never crashes) on a missing file', async () => {
  await assert.rejects(() => extractImageOcr('/definitely/does/not/exist.jpg'));
});

test('extractImageOcr rejects (never crashes) on a non-image file', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(Buffer.from('not an image at all'), 'fake.jpg');
  try {
    await assert.rejects(() => extractImageOcr(filePath));
  } finally {
    await cleanup();
  }
});

test('extractImageOcr rejects (never crashes the process) on a valid-header-but-corrupt-body image', async () => {
  // Run in a child process -- see fixtures/ocr-crash-guard-child.mjs for
  // why this can't run as a normal in-process node:test assertion.
  const dir = await mkdtemp(path.join(tmpdir(), 'ocr-crash-guard-'));
  const filePath = path.join(dir, 'corrupt.jpg');
  try {
    const { stdout } = await execFileAsync('node', [childScript, filePath], { cwd: projectRoot });
    assert.ok(stdout.includes('CAUGHT_CLEANLY:'), `expected clean rejection, got: ${stdout}`);
  } catch (err) {
    assert.fail(`child process crashed instead of rejecting cleanly: ${err.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

after(async () => {
  await terminateOcrWorker();
});
