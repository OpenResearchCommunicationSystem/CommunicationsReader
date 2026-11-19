import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { translateChunk, extractEntities, askQuestion } from '../src/ai-assist/providers/openai-compatible.js';

const CONFIG = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' };

afterEach(() => {
  mock.reset();
});

function mockFetchOnce(responseBody, status = 200) {
  const fn = mock.fn(async (url, options) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }));
  mock.method(globalThis, 'fetch', fn);
  return fn;
}

function chatResponse(content) {
  return { choices: [{ message: { content } }] };
}

test('translateChunk parses the "Detected language: X" header off the response and strips it from the translation', async () => {
  const fetchMock = mockFetchOnce(chatResponse('Detected language: Farsi\n\nHello there'));

  const result = await translateChunk(CONFIG, 'سلام');
  assert.deepEqual(result, { text: 'Hello there', detectedLanguage: 'Farsi' });

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(options.body);
  assert.match(body.messages[0].content, /سلام/);
  assert.match(body.messages[0].content, /Detected language/);
});

test('translateChunk falls back to the whole response as the translation when the header is missing', async () => {
  mockFetchOnce(chatResponse('just the translation, no header'));
  const result = await translateChunk(CONFIG, 'text');
  assert.deepEqual(result, { text: 'just the translation, no header', detectedLanguage: null });
});

test('extractEntities returns the raw model response untouched (parsing is the caller\'s job)', async () => {
  const raw = '[{"type":"organization","value":"Acme Corp","context":"met with Acme Corp on the 5th"}]';
  const fetchMock = mockFetchOnce(chatResponse(`  ${raw}  `));

  const result = await extractEntities(CONFIG, 'met with Acme Corp on the 5th');
  assert.equal(result, raw);

  const [, options] = fetchMock.mock.calls[0].arguments;
  const body = JSON.parse(options.body);
  assert.match(body.messages[0].content, /Acme Corp/);
  assert.match(body.messages[0].content, /JSON array/);
});

test('askQuestion injects the collection transcript as a system message ahead of the conversation', async () => {
  const fetchMock = mockFetchOnce(chatResponse('Yes, on Jan 1.'));

  const history = [{ role: 'user', content: 'Was there a meeting?' }, { role: 'assistant', content: 'Yes, Jan 1.' }];
  const result = await askQuestion(CONFIG, 'the collection transcript', [...history, { role: 'user', content: 'What date exactly?' }]);
  assert.equal(result, 'Yes, on Jan 1.');

  const [, options] = fetchMock.mock.calls[0].arguments;
  const body = JSON.parse(options.body);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /the collection transcript/);
  assert.equal(body.messages.length, 4, 'system + the full conversation history + the new question');
  assert.equal(body.messages[3].content, 'What date exactly?');
});

test('a non-2xx response throws with the status code and response body included', async () => {
  mockFetchOnce({ error: { message: 'bad request' } }, 400);
  await assert.rejects(() => translateChunk(CONFIG, 'text'), /400/);
});
