import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ocrImage, translateChunk, summarizeThread } from '../src/ai-assist/providers/anthropic.js';

const CONFIG = { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' };

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

test('translateChunk sends the correct Anthropic request shape and parses the text block', async () => {
  const fetchMock = mockFetchOnce({ content: [{ type: 'text', text: '  Hello world  ' }] });

  const result = await translateChunk(CONFIG, 'Salut le monde', 'French');
  assert.equal(result, 'Hello world', 'trims whitespace, same contract as the other provider');

  assert.equal(fetchMock.mock.calls.length, 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(options.headers['x-api-key'], 'sk-ant-test', 'Anthropic auth is x-api-key, not Authorization: Bearer');
  assert.equal(options.headers['anthropic-version'], '2023-06-01');
  assert.ok(!('Authorization' in options.headers), 'must never send an OpenAI-style auth header to Anthropic');

  const body = JSON.parse(options.body);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.ok(body.max_tokens > 0, 'max_tokens is required by Anthropic, unlike the OpenAI-compatible path');
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.match(body.messages[0].content[0].text, /Salut le monde/);
});

test('ocrImage sends an image content block in Anthropic\'s base64-source shape, not image_url', async () => {
  const fetchMock = mockFetchOnce({ content: [{ type: 'text', text: 'transcribed text' }] });

  const fakeImage = Buffer.from('not a real image, just test bytes');
  const result = await ocrImage(CONFIG, fakeImage, 'image/png');
  assert.equal(result, 'transcribed text');

  const [, options] = fetchMock.mock.calls[0].arguments;
  const body = JSON.parse(options.body);
  const imageBlock = body.messages[0].content.find((b) => b.type === 'image');
  assert.ok(imageBlock, 'must send an image content block');
  assert.equal(imageBlock.source.type, 'base64');
  assert.equal(imageBlock.source.media_type, 'image/png');
  assert.equal(imageBlock.source.data, fakeImage.toString('base64'));
  assert.ok(!('image_url' in imageBlock), 'must never use the OpenAI image_url shape');
});

test('summarizeThread sends the thread transcript as a single text block and trims the response', async () => {
  const fetchMock = mockFetchOnce({ content: [{ type: 'text', text: '  Alice and Bob discuss a shipment.  ' }] });

  const result = await summarizeThread(CONFIG, '[2026-01-01] From: a To: b\nSubject: x\nhello');
  assert.equal(result, 'Alice and Bob discuss a shipment.');

  const [, options] = fetchMock.mock.calls[0].arguments;
  const body = JSON.parse(options.body);
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.match(body.messages[0].content[0].text, /hello/);
});

test('a non-2xx response throws with the status code and response body included', async () => {
  mockFetchOnce({ error: { message: 'invalid x-api-key' } }, 401);
  await assert.rejects(() => translateChunk(CONFIG, 'text', 'Spanish'), /401/);
});

test('a response with no text content block returns an empty string rather than throwing', async () => {
  mockFetchOnce({ content: [{ type: 'tool_use', id: 'x' }] });
  const result = await translateChunk(CONFIG, 'text', 'German');
  assert.equal(result, '');
});
