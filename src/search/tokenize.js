// Word-boundary tokenizer and naive sentence splitter, shared by two
// consumers: search's NEAR/N operator (src/search/query-parser.js +
// evaluate.js) and the not-yet-built rationalization feature -- both are
// the same underlying operation (token-distance between two spans of
// text) applied in different contexts, so this lives in one place.
//
// Unlike crypto-detect/scan.js's ASCII-only isWordChar (fine there since
// its keyword list is either literal English words or exact Farsi
// phrases matched via indexOf), this tokenizer has to split arbitrary
// body text that is frequently Farsi -- so "word character" is Unicode
// letters/numbers/underscore, not [a-z0-9].
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch) {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Splits text into word tokens with character offsets. Returns
 * [{ text, start, end }, ...] in document order. Non-word characters
 * (whitespace, punctuation) are simply skipped, not emitted as tokens.
 */
export function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (isWordChar(text[i])) {
      const start = i;
      while (i < n && isWordChar(text[i])) i++;
      tokens.push({ text: text.slice(start, i), start, end: i });
    } else {
      i++;
    }
  }
  return tokens;
}

// '.', '!', '?' cover English; '؟' is the Farsi question mark (U+061F).
// A bare newline is also treated as a boundary -- real message bodies
// (especially quoted/forwarded chains) often have no terminal
// punctuation between what are functionally separate lines/sentences.
const SENTENCE_BOUNDARY = /[.!?؟\n]/;
const TRAILING_BOUNDARY_RUN = /[.!?؟\s]/;

/**
 * Naive, deterministic sentence splitter -- no NLP/language model, just
 * boundary characters. Returns [{ start, end }, ...] spans over the
 * original string, skipping any span that's blank once trimmed (e.g.
 * runs of blank lines between paragraphs).
 */
export function splitSentences(text) {
  if (!text) return [];
  const spans = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  while (i < n) {
    if (SENTENCE_BOUNDARY.test(text[i])) {
      let end = i + 1;
      while (end < n && TRAILING_BOUNDARY_RUN.test(text[end])) end++;
      spans.push({ start, end });
      start = end;
      i = end;
    } else {
      i++;
    }
  }
  if (start < n) spans.push({ start, end: n });
  return spans.filter((s) => text.slice(s.start, s.end).trim().length > 0);
}

// Tokens are always produced in ascending `start` order by tokenize(),
// so a binary search locates the token overlapping a given offset range
// without a linear scan over the whole document -- matters for large
// attachment extractedText, not just short email bodies.
function findTokenIndex(tokens, range) {
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = tokens[mid];
    if (t.end <= range.start) {
      lo = mid + 1;
    } else if (t.start >= range.end) {
      hi = mid - 1;
    } else {
      return mid; // overlaps [range.start, range.end)
    }
  }
  return -1;
}

/**
 * Given a pre-tokenized document and two character-offset ranges (each
 * { start, end }), returns the number of word tokens strictly between
 * them (0 if they overlap or are adjacent), or null if either range
 * doesn't land on any token (e.g. it's inside pure punctuation).
 */
export function tokenDistance(tokens, rangeA, rangeB) {
  const iA = findTokenIndex(tokens, rangeA);
  const iB = findTokenIndex(tokens, rangeB);
  if (iA === -1 || iB === -1) return null;
  if (iA === iB) return 0;
  return Math.abs(iA - iB) - 1;
}
