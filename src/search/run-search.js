import { listCommunications } from '../db/query.js';
import { parseQuery, SearchSyntaxError } from './query-parser.js';
import { evaluateQuery } from './evaluate.js';

/**
 * Ad-hoc, non-persisted search driver. Unlike crypto-detect's
 * run-scan.js, results are never written back to the DB -- they're
 * recomputed fresh on every call and returned directly to the caller,
 * since search queries are interactive/one-off rather than a
 * re-runnable batch scan (mirrors the "recompute on demand" pattern
 * src/threading/build-threads.js already uses for the same reason:
 * forensic archives are realistically thousands of rows, not millions).
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

  const communications = listCommunications(db, { datasetIds });
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
