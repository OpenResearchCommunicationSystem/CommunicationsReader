import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttachment } from '../src/extract/index.js';
import { extractAttachmentText } from '../src/extract/attachment-extract.js';
import { terminateOcrWorker } from '../src/extract/ocr.js';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('classifyAttachment: mimeType is the primary signal', () => {
  assert.equal(
    classifyAttachment({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'x.bin' }),
    'docx'
  );
  assert.equal(classifyAttachment({ mimeType: 'image/png', filename: 'x' }), 'image');
});

test('classifyAttachment: falls back to filename extension when mimeType is missing/generic', () => {
  assert.equal(classifyAttachment({ mimeType: 'application/octet-stream', filename: 'report.docx' }), 'docx');
  assert.equal(classifyAttachment({ mimeType: null, filename: 'photo.JPG' }), 'image');
});

test('classifyAttachment: legacy office formats and unknown types are unsupported', () => {
  assert.equal(classifyAttachment({ mimeType: 'application/msword', filename: 'old.doc' }), 'unsupported');
  assert.equal(classifyAttachment({ mimeType: 'video/mp4', filename: 'clip.mp4' }), 'unsupported');
});

test('extractAttachmentText: unsupported type is not_attempted, not a failure', async () => {
  const result = await extractAttachmentText({ mimeType: 'video/mp4', filename: 'clip.mp4', savedPath: '/does/not/exist.mp4' });
  assert.equal(result.status, 'not_attempted');
  assert.equal(result.method, null);
  assert.equal(result.error, null);
});

test('extractAttachmentText: a real docx succeeds', async () => {
  const { filePath, cleanup } = await writeBufferToTemp(buildMinimalDocx('Extraction contract test'), 'x.docx');
  try {
    const result = await extractAttachmentText({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'x.docx',
      savedPath: filePath,
    });
    assert.equal(result.status, 'attempted_succeeded');
    assert.equal(result.method, 'docx-mammoth');
    assert.ok(result.text.includes('Extraction contract test'));
  } finally {
    await cleanup();
  }
});

test('extractAttachmentText: a corrupt/missing file is attempted_failed, never throws', async () => {
  const result = await extractAttachmentText({
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: 'missing.docx',
    savedPath: '/definitely/does/not/exist/missing.docx',
  });
  assert.equal(result.status, 'attempted_failed');
  assert.equal(result.method, 'docx-mammoth');
  assert.ok(result.error);
  assert.equal(result.text, null);
});

after(async () => {
  await terminateOcrWorker();
});
