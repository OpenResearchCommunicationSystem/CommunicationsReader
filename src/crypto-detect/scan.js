import { WALLET_PATTERNS } from './wallet-patterns.js';
import { KEYWORDS } from './keywords.js';
import { context } from '../shared/text-context.js';

/**
 * Scans a plain string for wallet addresses and crypto/hawala-adjacent
 * keywords. Fully deterministic (regex + substring search), no AI
 * involved. Returns [{ matchType, matchedText, patternName, offset,
 * context }].
 */
export function scanText(text) {
  if (!text) return [];
  const normalized = text.normalize('NFC');
  const matches = [];

  for (const [matchType, pattern] of Object.entries(WALLET_PATTERNS)) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(normalized)) !== null) {
      matches.push({
        matchType,
        matchedText: m[0],
        patternName: matchType,
        offset: m.index,
        context: context(normalized, m.index, m[0].length),
      });
      // Guard against zero-length matches looping forever (not expected
      // with these patterns, but cheap insurance).
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }

  for (const { term, lang, patternName } of KEYWORDS) {
    const haystack = lang === 'en' ? normalized.toLowerCase() : normalized;
    const needle = lang === 'en' ? term.toLowerCase() : term;
    let fromIndex = 0;
    while (true) {
      const idx = haystack.indexOf(needle, fromIndex);
      if (idx === -1) break;

      if (lang === 'en') {
        const before = idx === 0 ? ' ' : haystack[idx - 1];
        const afterIdx = idx + needle.length;
        const after = afterIdx >= haystack.length ? ' ' : haystack[afterIdx];
        const isWordChar = (c) => /[a-z0-9]/i.test(c);
        if (isWordChar(before) || isWordChar(after)) {
          fromIndex = idx + 1;
          continue;
        }
      }

      matches.push({
        matchType: 'keyword',
        matchedText: normalized.slice(idx, idx + needle.length),
        patternName,
        offset: idx,
        context: context(normalized, idx, needle.length),
      });
      fromIndex = idx + needle.length;
    }
  }

  return matches;
}

export function scanCommunication(communication) {
  return scanText(communication.bodyText).map((m) => ({
    ...m,
    sourceField: 'bodyText',
    communicationId: communication.id,
    attachmentId: null,
  }));
}

export function scanAttachment(attachment) {
  if (!attachment.extractedText) return [];
  return scanText(attachment.extractedText).map((m) => ({
    ...m,
    sourceField: 'extractedText',
    communicationId: null,
    attachmentId: attachment.id,
  }));
}
