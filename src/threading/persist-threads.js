import { listCommunications } from '../db/query.js';
import { buildThreads } from './build-threads.js';

const updateStmtCache = new WeakMap();
function getUpdateStatement(db) {
  let stmt = updateStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE communications SET threadId = ?, threadMethod = ? WHERE id = ?`);
    updateStmtCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Recomputes threads (build-threads.js's header-link + subject-fallback
 * grouping) and writes threadId/threadMethod back onto every member's
 * communications row. Lets src/db/thread-query.js's getThreadsForDatasets
 * take a cheap group-by fast path instead of rebuilding the full
 * computation on every call -- doesn't scale to a near-TB dataset.
 *
 * datasetIds omitted means "recompute over the whole DB", deliberately:
 * threading can link messages across datasets (the same conversation
 * exported twice), so scoping a rebuild to only a newly-imported dataset
 * could miss or break a link to older data. This is a full, if less
 * frequent, rebuild -- call it once after an import completes, not per
 * batch (see electron/main.js).
 *
 * Returns { communicationCount, threadCount }.
 */
export function persistThreads(db, options = {}) {
  const { datasetIds } = options;
  const communications = listCommunications(db, { datasetIds });
  const threads = buildThreads(communications);

  const update = getUpdateStatement(db);
  db.exec('BEGIN');
  try {
    for (const thread of threads) {
      for (const member of thread.members) {
        update.run(thread.threadId, thread.method, member.communicationId);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { communicationCount: communications.length, threadCount: threads.length };
}
