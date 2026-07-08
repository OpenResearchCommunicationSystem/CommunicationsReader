import { listCommunications } from '../db/query.js';
import { parseQuery, SearchSyntaxError } from './query-parser.js';
import { evaluateQuery } from './evaluate.js';
import { narrowCandidates } from './candidate-narrow.js';

/**
 * Ad-hoc, non-persisted search driver. Unlike crypto-detect's
 * run-scan.js, results are never written back to the DB -- they're
 * recomputed fresh on every call and returned directly to the caller,
 * since search queries are interactive/one-off rather than a
 * re-runnable batch scan.
 *
 * narrowCandidates() (src/search/candidate-narrow.js) first tries to use
 * token_index to shrink the set of rows worth loading/evaluating at all
 * -- important once a dataset is too large to comfortably hold every
 * row's full body/attachment text in memory at once. It returns null
 * when the query can't be safely narrowed (a bare regex, a NOT, etc.),
 * in which case this falls back to the original full-scan behavior.
 * Either way, evaluateQuery() still runs over whatever set comes back --
 * narrowing is a performance step only, never a substitute for it.
 *
 * options: { datasetIds?: number[], query: string, limit?: number }
 * Returns { resultCount, results: [{ communicationId, hits }] } on a
 * valid query, or { resultCount: 0, results: [], error: string } if the
 * query fails to parse (bad regex/syntax) -- callers should surface
 * `error` as a user-facing message (the existing error-banner UI
 * pattern) rather than letting a malformed query throw.
 */
export function runSearch(db, options = {}) {
  const { datasetIds, query, limit } = options;

  if (!query || !query.trim()) {
    return { resultCount: 0, results: [] };
  }

  let ast;
  try {
    ast = parseQuery(query);
  } catch (err) {
    if (err instanceof SearchSyntaxError) {
      return { resultCount: 0, results: [], error: err.message };
    }
    throw err;
  }

  const candidateIds = narrowCandidates(db, ast);
  if (candidateIds !== null && candidateIds.size === 0) {
    // A real (non-null) empty candidate set means the index has already
    // proven no row can match -- returning early here matters because
    // listCommunications({ ids: [] }) treats an empty ids array as "no
    // id filter" (same as omitting it), not "match nothing".
    return { resultCount: 0, results: [] };
  }

  const communications = candidateIds === null
    ? listCommunications(db, { datasetIds })
    : listCommunications(db, { datasetIds, ids: [...candidateIds] });

  const results = [];
  for (const communication of communications) {
    const evaluated = evaluateQuery(ast, communication);
    if (evaluated) {
      results.push({ communicationId: communication.id, hits: evaluated.hits });
      if (typeof limit === 'number' && results.length >= limit) break;
    }
  }

  return { resultCount: results.length, results };
}
