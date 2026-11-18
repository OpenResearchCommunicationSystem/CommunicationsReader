// Targets Anthropic's native Messages API directly via fetch -- no SDK,
// same "plain fetch, no vendor library" rule as providers/openai-
// compatible.js. Genuinely a different wire format, not a variant of
// the OpenAI shape: auth is an `x-api-key` header (not `Authorization:
// Bearer`), every request needs an `anthropic-version` header, max_tokens
// is required (not optional), and image input is a `{type: 'image',
// source: {type: 'base64', media_type, data}}` content block rather than
// an `image_url` one. This is why Anthropic got its own file instead of
// being folded into openai-compatible.js -- see this project's Claude
// memory and ../index.js's own comment on why.
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;

async function messagesRequest({ baseUrl, apiKey, model }, content) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI API request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.content?.find((block) => block.type === 'text')?.text ?? '';
}

/**
 * Same contract as providers/openai-compatible.js's ocrImage().
 */
export async function ocrImage(config, imageBuffer, mimeType) {
  const text = await messagesRequest(config, [
    {
      type: 'text',
      text: 'Transcribe every piece of text visible in this image, verbatim, in its original language and script. Output only the transcribed text, with no commentary, preamble, or translation.',
    },
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') } },
  ]);
  return text.trim();
}

/**
 * Same contract as providers/openai-compatible.js's translateChunk().
 */
export async function translateChunk(config, text, langName) {
  const translated = await messagesRequest(config, [
    {
      type: 'text',
      text: `Translate the following ${langName} text into English. Output only the translation, with no commentary or preamble, preserving all numbers, reference codes, and proper nouns exactly as they appear:\n\n${text}`,
    },
  ]);
  return translated.trim();
}

/**
 * Same contract as providers/openai-compatible.js's summarizeThread().
 */
export async function summarizeThread(config, text) {
  const summary = await messagesRequest(config, [
    {
      type: 'text',
      text: `The following is a transcript of one email/message thread, each entry preceded by its date, sender, and recipient. Write a plain-language summary covering: who is involved, what they are discussing, and the key events/dates in chronological order. Output only the summary, with no commentary or preamble:\n\n${text}`,
    },
  ]);
  return summary.trim();
}
