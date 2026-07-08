import { tokenize } from './tokenize.js';

// Maps query-parser.js's field names to the fieldKind values
// token-index.js actually stores.
const QUERY_FIELD_TO_INDEX_FIELD = {
  subject: 'subject',
  body: 'body',
  from: 'from',
  to: 'to',
  attachment: 'attachment_text',
};

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

function candidatesForSubtoken(db, subtoken, fieldKind) {
  const pattern = '%' + escapeLike(subtoken.toLowerCase()) + '%';
  const rows = fieldKind
    ? db.prepare(`SELECT DISTINCT communicationId FROM token_index WHERE token LIKE ? ESCAPE '\\' AND fieldKind = ?`).all(pattern, fieldKind)
    : db.prepare(`SELECT DISTINCT communicationId FROM token_index WHERE token LIKE ? ESCAPE '\\'`).all(pattern);
  return new Set(rows.map((r) => r.communicationId));
}

function intersectAll(sets) {
  if (sets.length === 0) return new Set();
  let result = sets[0];
  for (let i = 1; i < sets.length && result.size > 0; i++) {
    const next = new Set();
    for (const id of result) {
      if (sets[i].has(id)) next.add(id);
    }
    result = next;
  }
  return result;
}

function intersectNullable(a, b) {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return intersectAll([a, b]);
}

function unionNullable(a, b) {
  // OR can't narrow at all if either side is unbounded (e.g. contains a
  // regex or a NOT) -- an unbounded branch could match almost anything,
  // so the union would just be "everything" anyway.
  if (a === null || b === null) return null;
  return new Set([...a, ...b]);
}

/**
 * Narrows one literal term (Word or Phrase -- Regex terms fall through
 * to null, see below) to a safe SUPERSET of candidate communicationIds.
 *
 * evaluate.js matches Word/Phrase terms as a plain case-insensitive
 * SUBSTRING of the field text, not a whole-word match -- searching
 * "trans" must still find a document whose only relevant token is
 * "transfer". To stay correct under that semantic without an FTS/
 * trigram index (deliberately not added -- see schema.js's token_index
 * comment), this decomposes the term's own value into its word-char
 * runs using the SAME tokenize() the index was built with, then
 * intersects each run's own substring-LIKE candidate set.
 *
 * This is provably safe (never excludes a true match): if the full term
 * value is present as a literal substring of some field's text, then
 * every one of its word-char runs is also present as a literal
 * substring of that same text (removing characters from a matched
 * substring leaves substrings that are still present) -- and any
 * word-char run present in a document must lie entirely within one of
 * that document's own tokenize()-produced tokens, since word-char runs
 * can't span a non-word-char boundary. So a LIKE '%run%' lookup against
 * token_index.token is guaranteed to find that row.
 *
 * A Regex term (or a term with no word-char content at all, e.g. pure
 * punctuation) can't be decomposed this way -- returns null, meaning
 * "cannot narrow, caller must fall back to a full scan for this leaf".
 */
function narrowTerm(db, term, fieldKind) {
  const subtokens = tokenize(term.value ?? '');
  if (subtokens.length === 0) return null;
  return intersectAll(subtokens.map((t) => candidatesForSubtoken(db, t.text, fieldKind)));
}

/**
 * Walks a parsed query AST (src/search/query-parser.js) and returns a
 * safe superset of candidate communicationIds that could possibly match,
 * or null if the query can't be narrowed at all. This is purely a
 * performance narrowing step -- src/search/run-search.js still runs the
 * real evaluateQuery() over whatever candidate set comes back, for exact
 * correctness (field scoping, NEAR proximity, regex, NOT). Narrowing
 * incorrectly in the direction of "too broad" is always safe; narrowing
 * "too narrow" (excluding a true match) is a correctness bug -- every
 * branch here is written to fail open (return null) rather than risk
 * that.
 */
export function narrowCandidates(db, node, fieldKind = null) {
  switch (node.type) {
    case 'Word':
    case 'Phrase':
      return narrowTerm(db, node, fieldKind);
    case 'Regex':
      return null;
    case 'Field':
      return narrowCandidates(db, node.term, QUERY_FIELD_TO_INDEX_FIELD[node.field] ?? fieldKind);
    case 'Near': {
      // NEAR requires both sides to match somewhere in the same text --
      // proximity is checked afterward by evaluateQuery over the
      // narrowed set, but "both terms present" is itself a necessary
      // (if insufficient) condition, safe to narrow on.
      const left = narrowTerm(db, node.left, fieldKind);
      const right = narrowTerm(db, node.right, fieldKind);
      return intersectNullable(left, right);
    }
    case 'Not':
      // The complement of an indexed match set isn't something this
      // index can answer -- would require enumerating every
      // communicationId NOT in the set, which needs its own full scan.
      return null;
    case 'And':
      return intersectNullable(narrowCandidates(db, node.left, fieldKind), narrowCandidates(db, node.right, fieldKind));
    case 'Or':
      return unionNullable(narrowCandidates(db, node.left, fieldKind), narrowCandidates(db, node.right, fieldKind));
    default:
      return null;
  }
}
