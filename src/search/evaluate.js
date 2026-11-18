// Evaluates a parsed query AST (src/search/query-parser.js) against one
// communication row (as returned by src/db/query.js's
// listCommunications/getCommunication, participants+attachments already
// attached). Pure and synchronous -- no DB access here, that's
// run-search.js's job.
import { tokenize, tokenDistance } from './tokenize.js';
import { context } from '../shared/text-context.js';

/**
 * Flattens one communication into named, searchable text sources.
 * "attachment" can appear multiple times (once per attachment with
 * extracted text) -- each carries attachmentId/filename so a hit can be
 * traced back to which attachment it came from.
 */
function fieldSourcesFor(communication) {
  const sources = [];
  if (communication.subject) sources.push({ field: 'subject', text: communication.subject });
  if (communication.bodyText) sources.push({ field: 'body', text: communication.bodyText });
  if (communication.fromRaw) sources.push({ field: 'from', text: communication.fromRaw });
  if (communication.toRaw) sources.push({ field: 'to', text: communication.toRaw });
  // A translated body is searchable in its own right -- an investigator
  // who translates a Farsi email to English still needs to find it by
  // searching the English text, not just the untranslated original.
  // Tagged 'translation' (the query-field name registered in
  // query-parser.js/candidate-narrow.js), not 'body_translation' (the
  // token_index fieldKind name) -- a Field AST node's .field is always
  // the query-side name, and this must match it exactly for scoped
  // searches like "translation:wallet" to re-confirm correctly against
  // this source, the same convention 'attachment' below already follows
  // relative to the 'attachment_text' index fieldKind.
  if (communication.translatedText) sources.push({ field: 'translation', text: communication.translatedText });
  for (const att of communication.attachments || []) {
    if (att.extractedText) {
      sources.push({ field: 'attachment', text: att.extractedText, attachmentId: att.id, filename: att.filename });
    }
    if (att.translatedText) {
      sources.push({ field: 'attachment_translation', text: att.translatedText, attachmentId: att.id, filename: att.filename });
    }
    // Filename is searchable regardless of whether extraction ever ran
    // or succeeded -- mirrors src/search/token-index.js's
    // indexAttachmentFilename(), which indexes it unconditionally at
    // insert time, and src/search/candidate-narrow.js's 'filename' field.
    if (att.filename) {
      sources.push({ field: 'filename', text: att.filename, attachmentId: att.id, filename: att.filename });
    }
  }
  return sources;
}

function findAllSubstring(text, needle) {
  if (!needle) return [];
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  const ranges = [];
  let from = 0;
  while (true) {
    const idx = hay.indexOf(n, from);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + needle.length });
    from = idx + Math.max(needle.length, 1);
  }
  return ranges;
}

function findAllRegex(text, source, flags) {
  const effectiveFlags = flags.includes('g') ? flags : flags + 'g';
  const re = new RegExp(source, effectiveFlags);
  const ranges = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++; // guard against zero-length-match infinite loop
  }
  return ranges;
}

function matchRangesForTerm(term, text) {
  if (!text) return [];
  switch (term.type) {
    case 'Word':
    case 'Phrase':
      return findAllSubstring(text, term.value);
    case 'Regex':
      return findAllRegex(text, term.source, term.flags);
    default:
      throw new Error(`Not a term node: ${term.type}`);
  }
}

function hitFromRange(source, start, end) {
  return {
    field: source.field,
    attachmentId: source.attachmentId ?? null,
    offset: start,
    length: end - start,
    matchedText: source.text.slice(start, end),
    context: context(source.text, start, end - start),
  };
}

function hitsForTerm(term, sources) {
  const hits = [];
  for (const source of sources) {
    for (const range of matchRangesForTerm(term, source.text)) {
      hits.push(hitFromRange(source, range.start, range.end));
    }
  }
  return hits;
}

function hitsForNear(node, sources) {
  const hits = [];
  for (const source of sources) {
    const leftRanges = matchRangesForTerm(node.left, source.text);
    const rightRanges = matchRangesForTerm(node.right, source.text);
    if (leftRanges.length === 0 || rightRanges.length === 0) continue;

    const tokens = tokenize(source.text);
    for (const l of leftRanges) {
      for (const r of rightRanges) {
        const distance = tokenDistance(tokens, l, r);
        if (distance !== null && distance <= node.distance) {
          const start = Math.min(l.start, r.start);
          const end = Math.max(l.end, r.end);
          hits.push(hitFromRange(source, start, end));
        }
      }
    }
  }
  return hits;
}

/**
 * Recursively evaluates one AST node against a set of field sources.
 * Returns { matched, hits }. `matched` is tracked independently of
 * `hits.length` because NOT's match state is the *absence* of its
 * inner match -- there's nothing to highlight for a successful NOT, so
 * its hits are always empty even when matched is true.
 */
function evalNode(node, sources) {
  switch (node.type) {
    case 'Word':
    case 'Phrase':
    case 'Regex': {
      const hits = hitsForTerm(node, sources);
      return { matched: hits.length > 0, hits };
    }
    case 'Near': {
      const hits = hitsForNear(node, sources);
      return { matched: hits.length > 0, hits };
    }
    case 'Field': {
      const scoped = sources.filter((s) => s.field === node.field);
      return evalNode(node.term, scoped);
    }
    case 'Not': {
      const inner = evalNode(node.node, sources);
      return { matched: !inner.matched, hits: [] };
    }
    case 'And': {
      const left = evalNode(node.left, sources);
      if (!left.matched) return { matched: false, hits: [] };
      const right = evalNode(node.right, sources);
      if (!right.matched) return { matched: false, hits: [] };
      return { matched: true, hits: [...left.hits, ...right.hits] };
    }
    case 'Or': {
      const left = evalNode(node.left, sources);
      const right = evalNode(node.right, sources);
      const matched = left.matched || right.matched;
      if (!matched) return { matched: false, hits: [] };
      return { matched: true, hits: [...(left.matched ? left.hits : []), ...(right.matched ? right.hits : [])] };
    }
    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

/**
 * Evaluates a parsed query against one communication. Returns null on no
 * match, or { matched: true, hits: [{ field, attachmentId, offset,
 * length, matchedText, context }] } on a match -- hits is used for
 * result highlighting/context display, not just a boolean.
 */
export function evaluateQuery(ast, communication) {
  const sources = fieldSourcesFor(communication);
  const result = evalNode(ast, sources);
  return result.matched ? { matched: true, hits: result.hits } : null;
}
