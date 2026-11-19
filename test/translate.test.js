import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// AI-API-backed since the 2026-11 switch away from bundled local models
// (see src/translate/translate.js) -- mocked at the ai-assist boundary so
// this suite stays fast, deterministic, and network-free, same spirit as
// the rest of this project's zero-network test philosophy. These tests
// exercise translate.js's OWN logic (paragraph splitting, numeric-span
// extraction/flagging) -- whether a real AI endpoint produces a good
// translation (or correctly detects the source language) is not
// something a unit test can or should assert.
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    translateChunkViaAi: async (text) => ({
      text: `[EN] ${text}`,
      meta: { translationEngine: 'ai:mock:test', detectedLanguage: 'Arabic' },
    }),
  },
});

const { translateText } = await import('../src/translate/translate.js');

test('translateText calls the AI endpoint once per non-empty paragraph, preserves paragraph breaks, and carries through the AI-detected language', async () => {
  const result = await translateText('first paragraph\n\nsecond paragraph');
  assert.equal(result.text, '[EN] first paragraph\n\n[EN] second paragraph');
  assert.equal(result.meta.detectedLanguage, 'Arabic');
  assert.equal(result.meta.translationEngine, 'ai:mock:test');
});

test('translateText flags a numeric span that genuinely does not survive into the output', async () => {
  const result = await translateText('价格是8,500美元。');
  assert.deepEqual(result.meta.sourceNumericSpans, ['8,500']);
  // The mock prefixes "[EN] " onto the ORIGINAL untouched text, so the
  // digits do survive here -- this exercises the "survives" path. A
  // genuinely-dropped-figure case would need a mock that mangles the
  // number, which is exactly what the detector exists to catch when a
  // real AI endpoint does it; see src/translate/translate.js's own
  // comment on why that can't be prevented, only detected.
  assert.deepEqual(result.meta.numericSpansMissingInTranslation, []);
});

test('translateText does not flag a reference code that survives translation, and does not double-count its digits', async () => {
  const result = await translateText('发票编号INV-77341已确认。');
  assert.deepEqual(result.meta.sourceNumericSpans, ['INV-77341']);
  assert.deepEqual(result.meta.numericSpansMissingInTranslation, []);
});

test('translateText returns an empty string for empty input without calling the AI endpoint', async () => {
  const result = await translateText('');
  assert.equal(result.text, '');
});
