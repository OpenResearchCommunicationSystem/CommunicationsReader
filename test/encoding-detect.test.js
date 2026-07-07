import { test } from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { isGarbageDecode, decodeWithVerification, verifyMessageBodyEncoding } from '../src/parser/encoding-detect.js';
import { buildWindows1256MislabeledEml, buildUtf8FarsiEml, FARSI_TEXT } from './fixtures/generate-fixtures.js';

test('isGarbageDecode: clean long string passes', () => {
  const clean = 'a'.repeat(200);
  assert.equal(isGarbageDecode(clean), false);
});

test('isGarbageDecode: long string with 1% bad chars passes (below 2% threshold)', () => {
  const s = '�' + 'a'.repeat(199); // 1/200 = 0.5%
  assert.equal(isGarbageDecode(s), false);
});

test('isGarbageDecode: long string with 3% bad chars fails (above 2% threshold)', () => {
  const badCount = 6;
  const s = '�'.repeat(badCount) + 'a'.repeat(194); // 6/200 = 3%
  assert.equal(isGarbageDecode(s), true);
});

test('isGarbageDecode: long string that is 100% bad fails', () => {
  const s = '�'.repeat(200);
  assert.equal(isGarbageDecode(s), true);
});

test('isGarbageDecode: short string below absolute floor passes', () => {
  const s = '��ab'; // 2 bad chars, floor is 3
  assert.equal(isGarbageDecode(s), false);
});

test('isGarbageDecode: short string at absolute floor fails', () => {
  const s = '���ab'; // 3 bad chars, meets floor
  assert.equal(isGarbageDecode(s), true);
});

test('isGarbageDecode: empty string never garbage', () => {
  assert.equal(isGarbageDecode(''), false);
});

test('decodeWithVerification: correct UTF-8 hint is trusted, no override', () => {
  const bytes = Buffer.from(FARSI_TEXT, 'utf8');
  const result = decodeWithVerification(bytes, 'utf-8');
  assert.equal(result.text, FARSI_TEXT);
  assert.equal(result.charsetOverridden, false);
  assert.equal(result.encodingUncertain, false);
});

test('decodeWithVerification: Windows-1256 bytes mislabeled as UTF-8 get overridden', () => {
  const win1256Bytes = iconv.encode(FARSI_TEXT, 'windows1256');
  const result = decodeWithVerification(win1256Bytes, 'utf-8');
  assert.equal(result.text, FARSI_TEXT);
  assert.equal(result.charsetOverridden, true);
  assert.equal(result.encodingUncertain, false);
});

test('verifyMessageBodyEncoding: end-to-end against the flagship mislabeled fixture', () => {
  const eml = buildWindows1256MislabeledEml();
  const result = verifyMessageBodyEncoding(eml);
  assert.ok(result);
  assert.equal(result.text, FARSI_TEXT);
  assert.equal(result.charsetOverridden, true);
});

test('verifyMessageBodyEncoding: happy path UTF-8 fixture needs no override', () => {
  const eml = buildUtf8FarsiEml();
  const result = verifyMessageBodyEncoding(eml);
  assert.ok(result);
  assert.equal(result.text, FARSI_TEXT);
  assert.equal(result.charsetOverridden, false);
});
