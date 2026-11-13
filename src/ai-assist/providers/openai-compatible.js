// Targets the OpenAI chat-completions wire format directly via fetch --
// no vendor SDK, since that format (not any one vendor's SDK) is what's
// actually shared across OpenAI, xAI's Grok (https://api.x.ai/v1), most
// local/self-hosted servers (Ollama, LM Studio, vLLM), and -- per the
// investigator's own org -- plausibly GenAI.mil, since many government
// AI gateways are built on the same OpenAI-compatible surface. If a
// specific gateway turns out NOT to speak this shape, it needs its own
// file under this directory (see the Anthropic/Gemini note in
// ../index.js), not a change here.
async function chatCompletion({ baseUrl, apiKey, model }, messages) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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

/**
 * Translates text into English via a plain chat completion. langName is
 * a human-readable language name (e.g. "Farsi"), not a code -- the model
 * doesn't need a strict code, and a plain-language instruction is more
 * robust across different providers/models than relying on one.
 */
export async function translateChunk(config, text, langName) {
  const translated = await chatCompletion(config, [
    {
      role: 'user',
      content: `Translate the following ${langName} text into English. Output only the translation, with no commentary or preamble, preserving all numbers, reference codes, and proper nouns exactly as they appear:\n\n${text}`,
    },
  ]);
  return translated.trim();
}
