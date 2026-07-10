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

test('translateText translates each paragraph of a multi-paragraph body independently', async () => {
  // Regression test for a real failure found via sample-data/dummy-dataset-
  // language-test-1.zip's "LONG" tier: feeding a multi-paragraph letter
  // through in one pass caused later paragraphs to merge into an
  // incoherent, fact-dropping mess. Two short, topically distinct
  // sentences here (not a full long letter, to keep this real-inference
  // test fast) -- both topics should survive recognizably and the join
  // should preserve the paragraph break.
  const text = 'مرحبا، كيف حالك اليوم؟\n\nشكرا جزيلا على مساعدتك.';
  const result = await translateText(text, 'ara');
  assert.match(result.text, /how|hi|hello/i);
  assert.match(result.text, /thank/i);
  assert.ok(result.text.includes('\n\n'), 'expected the paragraph break to be preserved in the joined output');
});

test('translateText flags a numeric span that did not survive translation', async () => {
  // Regression test for a real, reproducible failure: this exact short
  // isolated sentence ("The price is 8,500 dollars.") translates the
  // number into complete gibberish ("ki-da") with no numeral in it at
  // all -- confirmed not to be a chunking-size problem (see translate.js's
  // comment on why masking was tried and reverted). Since translation
  // itself can't be trusted to preserve this, meta.numericSpansMissingInTranslation
  // is the actual safety net -- this locks in that it fires correctly.
  const result = await translateText('价格是8,500美元。', 'chi_sim');
  assert.deepEqual(result.meta.sourceNumericSpans, ['8,500']);
  assert.deepEqual(result.meta.numericSpansMissingInTranslation, ['8,500']);
});

test('translateText does not flag a reference code that survives translation, and does not double-count its digits', async () => {
  const result = await translateText('发票编号INV-77341已确认。', 'chi_sim');
  assert.deepEqual(result.meta.sourceNumericSpans, ['INV-77341']);
  assert.deepEqual(result.meta.numericSpansMissingInTranslation, []);
});

test('translateText returns an empty string for empty input without invoking the model', async () => {
  const result = await translateText('', 'ara');
  assert.equal(result.text, '');
});

test('translateText rejects an unsupported language code', async () => {
  await assert.rejects(() => translateText('hello', 'not-a-real-lang'), /unsupported or missing source language/);
});
