const DEFAULT_CONTEXT_RADIUS = 40;

/**
 * Returns a snippet of `text` centered on a match, `radius` characters of
 * surrounding context on each side. Shared by src/crypto-detect/scan.js
 * and src/search/evaluate.js -- both need identical "show me a bit of
 * surrounding text" behavior around a match offset.
 */
export function context(text, offset, matchLength, radius = DEFAULT_CONTEXT_RADIUS) {
  const start = Math.max(0, offset - radius);
  const end = Math.min(text.length, offset + matchLength + radius);
  return text.slice(start, end);
}
