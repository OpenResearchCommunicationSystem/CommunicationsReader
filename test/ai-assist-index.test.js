import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mocks both of ai-assist/index.js's own dependencies -- config.js (so a
// fixed config can be injected without touching ai-config.json/
// safeStorage) and the openai-compatible provider (so this test can see
// exactly what config object index.js actually hands the provider,
// without making a real request). mock.module must be registered before
// the dynamic import below, same pattern every other ai-assist-adjacent
// test in this suite uses.
let loadedConfig = null;
mock.module('../src/ai-assist/config.js', {
  namedExports: {
    loadAiConfig: () => loadedConfig,
  },
});

let lastExtractEntitiesConfig = null;
let lastAskQuestionConfig = null;
mock.module('../src/ai-assist/providers/openai-compatible.js', {
  namedExports: {
    ocrImage: async () => '',
    translateChunk: async () => ({ text: '', detectedLanguage: null }),
    summarizeThread: async () => '',
    extractEntities: async (config) => {
      lastExtractEntitiesConfig = config;
      return '[]';
    },
    askQuestion: async (config) => {
      lastAskQuestionConfig = config;
      return 'an answer';
    },
  },
});

const { extractEntitiesViaAi, askQuestionViaAi, isAiConfigured } = await import('../src/ai-assist/index.js');

test('extractEntitiesViaAi uses analysisModel when set, leaving the main model untouched for OCR/translate', async () => {
  loadedConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    analysisModel: 'gpt-4o',
  };

  const result = await extractEntitiesViaAi('some text');
  assert.equal(lastExtractEntitiesConfig.model, 'gpt-4o', 'entity extraction runs on the stronger analysis model');
  assert.equal(result.meta.analysisEngine, 'ai:openai-compatible:gpt-4o');
});

test('askQuestionViaAi falls back to the main model when analysisModel is blank', async () => {
  loadedConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    analysisModel: '',
  };

  const result = await askQuestionViaAi('context', [{ role: 'user', content: 'hi' }]);
  assert.equal(lastAskQuestionConfig.model, 'gpt-4o-mini');
  assert.equal(result.meta.analysisEngine, 'ai:openai-compatible:gpt-4o-mini');
});

test('isAiConfigured / extractEntitiesViaAi return null/false when unconfigured, never throw', async () => {
  loadedConfig = null;
  assert.equal(isAiConfigured(), false);
  assert.equal(await extractEntitiesViaAi('text'), null);
  assert.equal(await askQuestionViaAi('context', []), null);
});
