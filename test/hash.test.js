import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRawHash, computeNormalizedHash, sha256, hashFileStreaming } from '../src/parser/hash.js';
import { normalizeBody } from '../src/parser/body-normalize.js';
import { buildDedupPair } from './fixtures/generate-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

test('rawHash of byte-identical messages matches', () => {
  const { identicalA, identicalB } = buildDedupPair();
  assert.equal(computeRawHash(identicalA), computeRawHash(identicalB));
});

test('normalizedHash matches for same content, differing envelope', () => {
  const { sameContentA, sameContentB } = buildDedupPair();

  const rawHashA = computeRawHash(sameContentA);
  const rawHashB = computeRawHash(sameContentB);
  assert.notEqual(rawHashA, rawHashB, 'raw bytes should differ (different headers/whitespace)');

  const normA = normalizeBody('This is the forwarded content.\nSecond line of content.');
  const normB = normalizeBody('This is the forwarded content.  \nSecond line of content.\n\n');
  const hashA = computeNormalizedHash(normA, { subject: 'Forwarded thread', from: 'Alice <alice@example.com>' });
  const hashB = computeNormalizedHash(normB, { subject: 'Forwarded thread', from: 'Alice <alice@example.com>' });
  assert.equal(hashA, hashB);
});

test('changing the body changes both hashes', () => {
  const rawA = Buffer.from('hello world');
  const rawB = Buffer.from('hello world!');
  assert.notEqual(computeRawHash(rawA), computeRawHash(rawB));

  const hashA = computeNormalizedHash('hello world', { subject: 's', from: 'f' });
  const hashB = computeNormalizedHash('hello world!', { subject: 's', from: 'f' });
  assert.notEqual(hashA, hashB);
});

test('hashFileStreaming matches sha256 of the same bytes computed in-memory', async () => {
  const content = Buffer.from('the whole archive, hashed via a streaming read');
  const { filePath, cleanup } = await writeBufferToTemp(content, 'archive.zip');
  try {
    const streamed = await hashFileStreaming(filePath);
    assert.equal(streamed, sha256(content));
  } finally {
    await cleanup();
  }
});

test('hashFileStreaming rejects (never throws synchronously) on a missing file', async () => {
  await assert.rejects(() => hashFileStreaming('/definitely/does/not/exist.zip'));
});
