import { listCommunications } from './query.js';
import { buildThreads, assembleThread } from '../threading/build-threads.js';

/**
 * Builds threads over whatever set of datasets is currently selected
 * (empty/omitted datasetIds means all datasets).
 *
 * Fast path: if every communication in scope already has a persisted
 * threadId (src/threading/persist-threads.js ran since the last import),
 * threads are reconstructed directly from a plain group-by -- no
 * header-link/subject-fallback recomputation, which is what doesn't
 * scale to a near-TB dataset. Falls back to the original on-demand
 * buildThreads() computation if ANY row in scope lacks a persisted
 * threadId (new data imported since the last persist, or persistThreads()
 * has simply never run yet) -- always correct, just not always the fast
 * path. New communications always start with threadId = NULL (see
 * src/db/map-email.js), so this fallback check is exactly "is there
 * unpersisted data in this scope".
 */
export function getThreadsForDatasets(db, datasetIds) {
  const communications = listCommunications(db, { datasetIds });
  if (communications.length === 0) return [];

  const allPersisted = communications.every((c) => c.threadId != null);
  return allPersisted ? groupByPersistedThreadId(communications) : buildThreads(communications);
}

function groupByPersistedThreadId(communications) {
  const byThreadId = new Map();
  for (const c of communications) {
    if (!byThreadId.has(c.threadId)) byThreadId.set(c.threadId, []);
    byThreadId.get(c.threadId).push(c);
  }

  const threads = [];
  for (const members of byThreadId.values()) {
    // threadMethod is persisted per-row alongside threadId (always
    // identical across one thread's members, since both are written
    // together by persistThreads()) -- fall back to a sane default only
    // in case a row was ever hand-edited outside the normal write path.
    const method = members[0].threadMethod ?? (members.length > 1 ? 'subject-fallback' : 'singleton');
    threads.push(assembleThread(members, method));
  }

  threads.sort((a, b) => (a.dateRange.start ?? 0) - (b.dateRange.start ?? 0));
  return threads;
}
