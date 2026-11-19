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

// Same parsing contract as providers/openai-compatible.js's
// parseTranslationResponse() -- see that file's comment for why a
// malformed header falls back to treating the whole response as the
// translation rather than failing outright.
function parseTranslationResponse(raw) {
  const match = raw.match(/^\s*Detected language:\s*(.+?)\s*\n+([\s\S]*)$/i);
  if (!match) return { text: raw.trim(), detectedLanguage: null };
  return { text: match[2].trim(), detectedLanguage: match[1].trim() };
}

/**
 * Same contract as providers/openai-compatible.js's translateChunk() --
 * asks the model to identify the source language itself rather than
 * requiring one to be picked beforehand.
 */
export async function translateChunk(config, text) {
  const raw = await messagesRequest(config, [
    {
      type: 'text',
      text: `Identify the source language of the following text, then translate it into English. Respond in exactly this format: the first line "Detected language: <language name>", then a blank line, then only the translation with no commentary or preamble, preserving all numbers, reference codes, and proper nouns exactly as they appear. If the text is already in English, the detected language is "English" and the translation is the text unchanged.\n\n${text}`,
    },
  ]);
  return parseTranslationResponse(raw);
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

/**
 * Same contract as providers/openai-compatible.js's extractEntities().
 */
export async function extractEntities(config, text) {
  const raw = await messagesRequest(config, [
    {
      type: 'text',
      text: `Extract named entities from the following communications text for an investigative/forensic review. Return ONLY a JSON array (no markdown code fences, no commentary) where each element is {"type": "person" | "organization" | "location" | "date" | "amount" | "account_or_reference" | "other", "value": "...", "context": "..."} -- "context" is a short (under 120 characters) snippet showing where the entity appeared. Return [] if there are none.\n\n${text}`,
    },
  ]);
  return raw.trim();
}

// Anthropic's Messages API takes `system` as a top-level request field,
// separate from `messages` -- unlike the OpenAI-compatible shape, which
// just prepends a system-role message to the same array. This is the one
// reason askQuestion needs its own request function rather than reusing
// messagesRequest() (which hard-codes a single user-role message).
async function conversationRequest({ baseUrl, apiKey, model }, { system, messages }) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI API request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.content?.find((block) => block.type === 'text')?.text ?? '';
}

/**
 * Same contract as providers/openai-compatible.js's askQuestion().
 */
export async function askQuestion(config, contextText, messages) {
  const system = `You are assisting an investigator with deep analysis of a curated set of communications for an e-discovery/investigative research task. Answer only from the material below; if the answer isn't in it, say so plainly rather than guessing. This is a triage aid, not an evidentiary finding -- flag uncertainty rather than overstating confidence.\n\n${contextText}`;
  const answer = await conversationRequest(config, { system, messages });
  return answer.trim();
}
