import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {
  checkRawSize,
  checkStructuralLimits,
  AttachmentLimitError,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ATTACHMENT_BYTES,
} from '../src/extract/limits.js';
import { buildMinimalDocx, buildMinimalPdfWithText } from './fixtures/generate-office-fixtures.js';

test('checkRawSize: passes under the limit', () => {
  assert.doesNotThrow(() => checkRawSize(1024));
});

test('checkRawSize: throws AttachmentLimitError over the limit', () => {
  assert.throws(() => checkRawSize(MAX_ATTACHMENT_BYTES + 1), AttachmentLimitError);
});

test('checkStructuralLimits: a normal docx passes', async () => {
  await assert.doesNotReject(() => checkStructuralLimits('docx', buildMinimalDocx()));
});

test('checkStructuralLimits: a normal pdf passes', async () => {
  await assert.doesNotReject(() => checkStructuralLimits('pdf', buildMinimalPdfWithText()));
});

test('checkStructuralLimits: image has no structural check and always passes', async () => {
  await assert.doesNotReject(() => checkStructuralLimits('image', Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test('checkStructuralLimits: a zip with too many entries is rejected (zip-bomb guard)', async () => {
  const zip = new AdmZip();
  for (let i = 0; i < MAX_ZIP_ENTRY_COUNT + 1; i++) {
    zip.addFile(`f${i}.txt`, Buffer.from('x'));
  }
  await assert.rejects(() => checkStructuralLimits('docx', zip.toBuffer()), AttachmentLimitError);
});
