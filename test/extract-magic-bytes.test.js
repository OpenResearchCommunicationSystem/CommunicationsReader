import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { verifyAttachmentKind } from '../src/extract/magic-bytes.js';
import {
  buildMinimalDocx,
  buildMinimalXlsx,
  buildMinimalPptx,
  buildMinimalPdfWithText,
} from './fixtures/generate-office-fixtures.js';

test('verifyAttachmentKind: a real docx verifies as docx', () => {
  const { mismatch, verifiedKind } = verifyAttachmentKind(buildMinimalDocx(), 'docx');
  assert.equal(mismatch, false);
  assert.equal(verifiedKind, 'docx');
});

test('verifyAttachmentKind: a real xlsx verifies as xlsx', async () => {
  const buf = await buildMinimalXlsx();
  const { mismatch, verifiedKind } = verifyAttachmentKind(Buffer.from(buf), 'xlsx');
  assert.equal(mismatch, false);
  assert.equal(verifiedKind, 'xlsx');
});

test('verifyAttachmentKind: a real pptx verifies as pptx', () => {
  const { mismatch, verifiedKind } = verifyAttachmentKind(buildMinimalPptx(), 'pptx');
  assert.equal(mismatch, false);
  assert.equal(verifiedKind, 'pptx');
});

test('verifyAttachmentKind: a real pdf verifies as pdf', () => {
  const { mismatch, verifiedKind } = verifyAttachmentKind(buildMinimalPdfWithText(), 'pdf');
  assert.equal(mismatch, false);
  assert.equal(verifiedKind, 'pdf');
});

test('verifyAttachmentKind: a real image verifies as image', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const { mismatch, verifiedKind } = verifyAttachmentKind(pngHeader, 'image');
  assert.equal(mismatch, false);
  assert.equal(verifiedKind, 'image');
});

test('verifyAttachmentKind: a docx renamed to look like a pdf is rejected as a mismatch', () => {
  const { mismatch, verifiedKind } = verifyAttachmentKind(buildMinimalDocx(), 'pdf');
  assert.equal(mismatch, true);
  assert.equal(verifiedKind, 'docx');
});

test('verifyAttachmentKind: an executable disguised as an image is rejected', () => {
  const fakeExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header
  const { mismatch, verifiedKind } = verifyAttachmentKind(fakeExe, 'image');
  assert.equal(mismatch, true);
  assert.notEqual(verifiedKind, 'image');
});

test('verifyAttachmentKind: a plain zip with no OOXML marker entry is a mismatch, not silently accepted', () => {
  const zip = new AdmZip();
  zip.addFile('random.txt', Buffer.from('not office content'));
  const { mismatch, verifiedKind } = verifyAttachmentKind(zip.toBuffer(), 'docx');
  assert.equal(mismatch, true);
  assert.equal(verifiedKind, 'zip-unknown');
});

test('verifyAttachmentKind: an xlsx claimed as docx is a mismatch even though both are OOXML zips', () => {
  // Confirms the check looks at the actual marker entry, not just "is a zip".
  const zip = new AdmZip();
  zip.addFile('xl/workbook.xml', Buffer.from('<workbook/>'));
  const { mismatch, verifiedKind } = verifyAttachmentKind(zip.toBuffer(), 'docx');
  assert.equal(mismatch, true);
  assert.equal(verifiedKind, 'xlsx');
});

test('verifyAttachmentKind: unrelated/garbage bytes verify as unknown, not any supported kind', () => {
  const { mismatch, verifiedKind } = verifyAttachmentKind(Buffer.from('just some plain text'), 'pdf');
  assert.equal(mismatch, true);
  assert.equal(verifiedKind, 'unknown');
});
