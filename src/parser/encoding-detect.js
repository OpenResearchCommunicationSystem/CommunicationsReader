import chardet from 'chardet';
import iconv from 'iconv-lite';
import { findPrimaryTextPart } from './mime-raw-part.js';

const GARBAGE_RATIO_THRESHOLD = 0.02;
const GARBAGE_ABS_FLOOR = 3;
const SHORT_STRING_CUTOFF = 150;

const CHARSET_ALIASES = {
  utf8: 'utf8',
  'utf-8': 'utf8',
  ascii: 'ascii',
  'us-ascii': 'ascii',
  'windows-1256': 'windows1256',
  cp1256: 'windows1256',
  'iso-8859-6': 'iso88596',
};

function normalizeCharsetName(name) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  if (CHARSET_ALIASES[lower]) return CHARSET_ALIASES[lower];
  return lower.replace(/[^a-z0-9]/g, '');
}

/**
 * Decides whether a decoded string looks like a botched decode (wrong
 * source charset). Two strong, low-false-positive signals:
 *  - U+FFFD replacement characters: iconv-lite emits these when it hits a
 *    byte sequence it cannot map at all in the target encoding.
 *  - C0/C1 control characters (excluding \n \r \t): the classic artifact of
 *    decoding a single-byte codepage (e.g. Windows-1256 Arabic script)
 *    as if it were UTF-8/Latin-1 -- misinterpreted high-bit bytes render
 *    as control codes, essentially never present in legitimate prose.
 */
export function isGarbageDecode(s) {
  if (s.length === 0) return false;

  let badCount = 0;
  const total = s.length;

  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code === 0xfffd) {
      badCount++;
    } else if (
      code <= 0x08 ||
      (code >= 0x0b && code <= 0x0c) ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f)
    ) {
      badCount++;
    }
  }

  if (total < SHORT_STRING_CUTOFF) {
    return badCount >= GARBAGE_ABS_FLOOR;
  }
  return badCount / total > GARBAGE_RATIO_THRESHOLD;
}

function tryDecode(bytes, charsetName) {
  if (!iconv.encodingExists(charsetName)) return null;
  try {
    return iconv.decode(bytes, charsetName);
  } catch {
    return null;
  }
}

/**
 * Decodes rawBytes to text, verifying the declared charset hint against
 * statistical detection and the garbage-decode heuristic before trusting
 * it, per the "never assume UTF-8" data quirk.
 *
 * Returns { text, charsetUsed, charsetOverridden, encodingUncertain }.
 */
export function decodeWithVerification(rawBytes, declaredCharsetHint) {
  const hint = declaredCharsetHint || 'utf8';
  const hintDecoded = tryDecode(rawBytes, hint);

  const candidates = chardet.analyse(rawBytes) || [];
  const hintNormalized = normalizeCharsetName(hint);
  const topCandidateNormalized = candidates[0] ? normalizeCharsetName(candidates[0].name) : null;

  if (hintDecoded !== null && hintNormalized === topCandidateNormalized) {
    return { text: hintDecoded, charsetUsed: hint, charsetOverridden: false, encodingUncertain: false };
  }

  if (hintDecoded !== null && !isGarbageDecode(hintDecoded)) {
    return { text: hintDecoded, charsetUsed: hint, charsetOverridden: false, encodingUncertain: false };
  }

  // Hint failed (or was garbage) -- walk chardet's ranked candidates.
  const tried = new Set([hintNormalized]);
  let bestAttempt = hintDecoded !== null ? { text: hintDecoded, charsetUsed: hint } : null;

  for (const candidate of candidates) {
    const normalized = normalizeCharsetName(candidate.name);
    if (tried.has(normalized)) continue;
    tried.add(normalized);

    const decoded = tryDecode(rawBytes, candidate.name);
    if (decoded === null) continue;
    if (!bestAttempt) bestAttempt = { text: decoded, charsetUsed: candidate.name };

    if (!isGarbageDecode(decoded)) {
      return {
        text: decoded,
        charsetUsed: candidate.name,
        charsetOverridden: true,
        encodingUncertain: false,
      };
    }
  }

  // Every candidate looked like garbage (or decode failed outright) --
  // never discard the message; surface the best-scoring attempt and flag
  // it for manual review downstream.
  if (bestAttempt) {
    return {
      text: bestAttempt.text,
      charsetUsed: bestAttempt.charsetUsed,
      charsetOverridden: bestAttempt.charsetUsed !== hint,
      encodingUncertain: true,
    };
  }

  return { text: rawBytes.toString('utf8'), charsetUsed: 'utf8', charsetOverridden: false, encodingUncertain: true };
}

/**
 * Runs the full verification pass against a raw message buffer's primary
 * text body part. Returns null if no text part could be located (caller
 * should fall back to trusting mailparser's own decoded text untouched).
 */
export function verifyMessageBodyEncoding(rawMessageBytes) {
  const part = findPrimaryTextPart(rawMessageBytes);
  if (!part) return null;

  const result = decodeWithVerification(part.rawContentBytes, part.charsetHint);
  return { ...result, contentType: part.contentType };
}
