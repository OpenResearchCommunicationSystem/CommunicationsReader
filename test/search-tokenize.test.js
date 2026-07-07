import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, splitSentences, tokenDistance } from '../src/search/tokenize.js';

test('tokenize splits English words and reports correct offsets', () => {
  const tokens = tokenize('wallet address, please send funds.');
  assert.deepEqual(
    tokens.map((t) => t.text),
    ['wallet', 'address', 'please', 'send', 'funds']
  );
  const first = tokens[0];
  assert.equal('wallet address, please send funds.'.slice(first.start, first.end), 'wallet');
});

test('tokenize handles Farsi text (Unicode word chars, not just ASCII)', () => {
  const tokens = tokenize('گواهی بازرسی SGS برای پمپ‌های KSB');
  assert.ok(tokens.length >= 4);
  assert.ok(tokens.some((t) => t.text === 'گواهی'));
  assert.ok(tokens.some((t) => t.text === 'SGS'));
});

test('tokenize returns empty array for empty/nullish input', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
});

test('splitSentences splits on ./!/? and newlines, skipping blank spans', () => {
  const text = 'First sentence. Second one!\nThird?\n\nFourth.';
  const spans = splitSentences(text).map((s) => text.slice(s.start, s.end).trim());
  assert.deepEqual(spans, ['First sentence.', 'Second one!', 'Third?', 'Fourth.']);
});

test('splitSentences treats a bare newline as a boundary even with no punctuation', () => {
  const text = 'line one\nline two';
  const spans = splitSentences(text).map((s) => text.slice(s.start, s.end).trim());
  assert.deepEqual(spans, ['line one', 'line two']);
});

test('tokenDistance is 0 for overlapping/adjacent ranges', () => {
  const text = 'alpha beta gamma';
  const tokens = tokenize(text);
  const alpha = { start: 0, end: 5 };
  const beta = { start: 6, end: 10 };
  assert.equal(tokenDistance(tokens, alpha, beta), 0);
});

test('tokenDistance counts tokens strictly between two ranges', () => {
  const text = 'alpha beta gamma delta epsilon';
  const tokens = tokenize(text);
  const alpha = { start: 0, end: 5 }; // token 0
  const epsilon = { start: 23, end: 30 }; // token 4
  // beta, gamma, delta sit strictly between alpha and epsilon -> 3
  assert.equal(tokenDistance(tokens, alpha, epsilon), 3);
});

test('tokenDistance returns null when a range does not land on any token', () => {
  const text = 'alpha ... beta';
  const tokens = tokenize(text);
  const punctuationOnly = { start: 6, end: 9 }; // the "..." run
  const beta = { start: 10, end: 14 };
  assert.equal(tokenDistance(tokens, punctuationOnly, beta), null);
});
