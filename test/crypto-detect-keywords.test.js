import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../src/crypto-detect/scan.js';
import { KEYWORDS } from '../src/crypto-detect/keywords.js';

test('every English keyword is detected in a simple sentence', () => {
  for (const { term, lang, patternName } of KEYWORDS.filter((k) => k.lang === 'en')) {
    const text = `This message mentions ${term} in passing.`;
    const matches = scanText(text).filter((m) => m.patternName === patternName);
    assert.ok(matches.length > 0, `expected to match keyword: ${term}`);
  }
});

test('every Farsi keyword is detected, including both bitcoin transliteration variants', () => {
  for (const { term, patternName } of KEYWORDS.filter((k) => k.lang === 'fa')) {
    const text = `پیام حاوی ${term} است.`;
    const matches = scanText(text).filter((m) => m.patternName === patternName);
    assert.ok(matches.length > 0, `expected to match Farsi keyword: ${term}`);
  }
});

test('English keyword matching respects word boundaries (no false positive on substrings)', () => {
  // "tether" should not match inside an unrelated longer word.
  const matches = scanText('The teethering cable snapped.').filter((m) => m.patternName === 'keyword_en_tether');
  assert.equal(matches.length, 0);
});

test('English keyword matching is case-insensitive', () => {
  const matches = scanText('We discussed BITCOIN yesterday.').filter((m) => m.patternName === 'keyword_en_bitcoin');
  assert.ok(matches.length > 0);
});

test('a common English word used in a non-crypto sense is a known false-positive risk (documented, not solved)', () => {
  // "wallet" alone isn't in our keyword list (only "crypto wallet" is),
  // specifically to avoid this false positive -- this test documents
  // that choice rather than asserting a fix.
  const matches = scanText('He left his leather wallet on the train.');
  assert.equal(matches.filter((m) => m.matchType === 'keyword').length, 0);
});
