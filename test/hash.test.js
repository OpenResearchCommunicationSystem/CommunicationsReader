import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRawHash, computeNormalizedHash } from '../src/parser/hash.js';
import { normalizeBody } from '../src/parser/body-normalize.js';
import { buildDedupPair } from './fixtures/generate-fixtures.js';

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
