import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateText, AVAILABLE_LANGS } from '../src/translate/translate.js';

// Real model inference, not mocked -- same philosophy as
// test/extract-ocr-langs.test.js exercising real Tesseract recognition.
// Requires models/translation/<code>/ to be populated first (see
// scripts/fetch-translation-models.mjs).

test('AVAILABLE_LANGS does not include English (foreign-to-English only) or Greek (known unresolved gap)', () => {
  assert.equal(AVAILABLE_LANGS.eng, undefined);
  assert.equal(AVAILABLE_LANGS.ell, undefined);
  assert.ok(AVAILABLE_LANGS.ara);
  assert.ok(AVAILABLE_LANGS.fas);
});

test('translateText translates Arabic (Marian path) into English', async () => {
  const result = await translateText('مرحبا، كيف حالك اليوم؟', 'ara');
  assert.ok(result.text.length > 0);
  assert.match(result.text, /how|hi|hello/i);
  assert.equal(result.meta.sourceLang, 'ara');
  assert.equal(result.meta.translationEngine, 'transformers.js');
});

test('translateText translates Farsi (mT5 path) into English', async () => {
  const result = await translateText('سلام، حال شما چطور است؟', 'fas');
  assert.ok(result.text.length > 0);
  assert.match(result.text, /how|hi|hello/i);
  assert.equal(result.meta.sourceLang, 'fas');
});

test('translateText returns an empty string for empty input without invoking the model', async () => {
  const result = await translateText('', 'ara');
  assert.equal(result.text, '');
});

test('translateText rejects an unsupported language code', async () => {
  await assert.rejects(() => translateText('hello', 'not-a-real-lang'), /unsupported or missing source language/);
});
