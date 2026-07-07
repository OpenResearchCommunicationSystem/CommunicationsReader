const QUOTE_LINE_RE = /^\s*>/;
const REPLY_HEADER_RE = /^(from|to|cc|bcc|sent|subject|date):/i;
const ON_WROTE_RE = /^on .+ wrote:$/i;
const ORIGINAL_MESSAGE_RE = /^-{2,}\s*original message\s*-{2,}$/i;
const FORWARDED_MESSAGE_RE = /^-{2,}\s*forwarded message\s*-{2,}$/i;

export function normalizeBody(bodyText) {
  if (!bodyText) return '';

  const lines = bodyText.split(/\r\n|\r|\n/);
  const kept = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (QUOTE_LINE_RE.test(line)) continue;
    if (REPLY_HEADER_RE.test(trimmed)) continue;
    if (ON_WROTE_RE.test(trimmed)) continue;
    if (ORIGINAL_MESSAGE_RE.test(trimmed)) continue;
    if (FORWARDED_MESSAGE_RE.test(trimmed)) continue;
    kept.push(trimmed);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}
