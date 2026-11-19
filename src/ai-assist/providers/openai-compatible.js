// Targets the OpenAI chat-completions wire format directly via fetch --
// no vendor SDK, since that format (not any one vendor's SDK) is what's
// actually shared across OpenAI, xAI's Grok (https://api.x.ai/v1), most
// local/self-hosted servers (Ollama, LM Studio, vLLM), and plenty of
// organizational AI gateways built on the same OpenAI-compatible
// surface. If a specific gateway turns out NOT to speak this shape, it
// needs its own file under this directory (see the Anthropic/Gemini
// note in ../index.js), not a change here.
async function chatCompletion({ baseUrl, apiKey, model, orgId }, messages) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  // Optional -- OpenAI accounts belonging to multiple orgs may need this
  // to bill/route to the right one. Harmless no-op for providers that
  // don't recognize the header (Grok, local servers).
  if (orgId) headers['OpenAI-Organization'] = orgId;

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI API request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Transcribes an image's text via a vision-capable chat completion.
 * Returns plain text, no confidence score (unlike Tesseract, these APIs
 * don't expose one) -- meta.ocrConfidenceMean is always null here.
 */
export async function ocrImage(config, imageBuffer, mimeType) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const text = await chatCompletion(config, [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Transcribe every piece of text visible in this image, verbatim, in its original language and script. Output only the transcribed text, with no commentary, preamble, or translation.',
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ]);
  return text.trim();
}

// Parses the "Detected language: <name>\n\n<translation>" format requested
// by translateChunk's prompt below. Falls back to treating the whole
// response as the translation with no detected language if the model
// didn't follow the format exactly -- a malformed header is not worth
// failing the whole translation over.
function parseTranslationResponse(raw) {
  const match = raw.match(/^\s*Detected language:\s*(.+?)\s*\n+([\s\S]*)$/i);
  if (!match) return { text: raw.trim(), detectedLanguage: null };
  return { text: match[2].trim(), detectedLanguage: match[1].trim() };
}

/**
 * Translates text into English via a plain chat completion, asking the
 * model to identify the source language itself rather than requiring the
 * investigator to pick one beforehand -- a modern general-purpose model
 * auto-detects language reliably, unlike the small per-language models
 * this app used before the 2026-11 AI-API switch.
 */
export async function translateChunk(config, text) {
  const raw = await chatCompletion(config, [
    {
      role: 'user',
      content: `Identify the source language of the following text, then translate it into English. Respond in exactly this format: the first line "Detected language: <language name>", then a blank line, then only the translation with no commentary or preamble, preserving all numbers, reference codes, and proper nouns exactly as they appear. If the text is already in English, the detected language is "English" and the translation is the text unchanged.\n\n${text}`,
    },
  ]);
  return parseTranslationResponse(raw);
}

/**
 * Summarizes an already-assembled thread transcript (see
 * src/threading/summarize-thread.js for how `text` is built) into plain
 * prose -- who's involved, what they're discussing, key dates/events.
 * This is a triage aid, not an evidentiary finding (see this project's
 * "POC, not evidence" rule): the investigator still reads the actual
 * messages, this just orients them faster across a long thread.
 */
export async function summarizeThread(config, text) {
  const summary = await chatCompletion(config, [
    {
      role: 'user',
      content: `The following is a transcript of one email/message thread, each entry preceded by its date, sender, and recipient. Write a plain-language summary covering: who is involved, what they are discussing, and the key events/dates in chronological order. Output only the summary, with no commentary or preamble:\n\n${text}`,
    },
  ]);
  return summary.trim();
}

/**
 * Extracts named entities from an already-assembled collection transcript
 * (see src/forensics/entity-extraction.js) as raw text expected to be a
 * JSON array -- parsing/validating that JSON is the caller's job, not
 * this provider's, same "providers return raw text, callers interpret
 * it" split translate.js/summarize-thread.js already follow.
 */
export async function extractEntities(config, text) {
  const raw = await chatCompletion(config, [
    {
      role: 'user',
      content: `Extract named entities from the following communications text for an investigative/forensic review. Return ONLY a JSON array (no markdown code fences, no commentary) where each element is {"type": "person" | "organization" | "location" | "date" | "amount" | "account_or_reference" | "other", "value": "...", "context": "..."} -- "context" is a short (under 120 characters) snippet showing where the entity appeared. Return [] if there are none.\n\n${text}`,
    },
  ]);
  return raw.trim();
}

/**
 * Answers a follow-up question about an already-assembled collection
 * transcript, given the running conversation so far (see
 * src/forensics/qa-chat.js) -- the transcript is injected as a system
 * message so it isn't repeated in every user turn, and `messages` (an
 * array of {role: 'user'|'assistant', content}) is passed straight
 * through to the chat-completions call since that's already this
 * format's native multi-turn shape.
 */
export async function askQuestion(config, contextText, messages) {
  const systemPrompt = {
    role: 'system',
    content: `You are assisting an investigator with deep analysis of a curated set of communications for an e-discovery/investigative research task. Answer only from the material below; if the answer isn't in it, say so plainly rather than guessing. This is a triage aid, not an evidentiary finding -- flag uncertainty rather than overstating confidence.\n\n${contextText}`,
  };
  const answer = await chatCompletion(config, [systemPrompt, ...messages]);
  return answer.trim();
}
