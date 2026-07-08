import { createHash } from 'node:crypto';
import { normalizeSubject } from './normalize-subject.js';

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function parseReferences(row) {
  if (Array.isArray(row.references)) return row.references;
  if (typeof row.referencesJson === 'string') {
    try {
      const parsed = JSON.parse(row.referencesJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function participantIdentifiers(row) {
  const list = row.participants || [];
  return new Set(list.map((p) => (p.identifier || '').trim().toLowerCase()).filter(Boolean));
}

function hasOverlap(setA, setB) {
  for (const v of setA) {
    if (setB.has(v)) return true;
  }
  return false;
}

function stableThreadId(memberIds) {
  const sorted = [...memberIds].sort((a, b) => a - b);
  return 'thr_' + createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
}

/**
 * Assembles one thread's full output object (the { threadId, method,
 * subject, ... } shape) from an already-known, already-grouped set of
 * member communication rows. Exported so src/db/thread-query.js's
 * persisted-threadId fast path (src/threading/persist-threads.js writes
 * threadId/threadMethod back onto rows at ingest time) can reconstruct
 * the exact same shape from a plain group-by, without recomputing the
 * header-link/subject-fallback grouping itself -- and without a second,
 * separately-maintained copy of this assembly logic to drift out of sync
 * with buildThreads() over time.
 */
export function assembleThread(members, method) {
  const sorted = [...members].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const participantSet = new Set();
  for (const m of sorted) {
    for (const p of participantIdentifiers(m)) participantSet.add(p);
  }

  const timestamps = sorted.map((m) => m.timestamp).filter((t) => typeof t === 'number');
  const dateRange = {
    start: timestamps.length ? Math.min(...timestamps) : null,
    end: timestamps.length ? Math.max(...timestamps) : null,
  };

  return {
    threadId: stableThreadId(sorted.map((m) => m.id)),
    method,
    subject: sorted[0]?.subject ?? null,
    normalizedSubject: normalizeSubject(sorted[0]?.subject),
    participants: [...participantSet],
    dateRange,
    messageCount: sorted.length,
    members: sorted.map((m) => ({
      communicationId: m.id,
      datasetId: m.datasetId,
      timestamp: m.timestamp,
      subject: m.subject,
    })),
  };
}

/**
 * Groups a flat array of communication rows (as returned by
 * src/db/query.js's listCommunications/getCommunication, each with a
 * `participants` array attached) into threads, using two signals:
 *
 *  1. Header-based (confident): Message-ID / In-Reply-To / References,
 *     when present and resolvable to another message in the given set.
 *  2. Subject+participant fallback (lower confidence): applied only to
 *     messages that ended up with no resolved header link -- normalized
 *     subject (Re:/Fwd: stripped) plus any overlapping participant
 *     identifier groups them together.
 *
 * Never merges a fallback candidate into an existing header-confirmed
 * thread, and never re-groups header-confirmed threads by subject --
 * keeps the two confidence levels visibly distinct (thread.method).
 *
 * Returns an array of:
 *   { threadId, method: 'header'|'subject-fallback'|'singleton',
 *     subject, normalizedSubject, participants: string[],
 *     dateRange: {start, end}, messageCount, members: [...] }
 */
export function buildThreads(communications) {
  const n = communications.length;
  if (n === 0) return [];

  const uf = new UnionFind(n);
  const indexByMessageId = new Map();
  communications.forEach((c, i) => {
    if (c.messageId) indexByMessageId.set(c.messageId, i);
  });

  const linkedIndices = new Set();
  communications.forEach((c, i) => {
    const candidates = [];
    if (c.inReplyTo) candidates.push(c.inReplyTo);
    for (const ref of parseReferences(c)) candidates.push(ref);

    for (const ref of candidates) {
      const targetIndex = indexByMessageId.get(ref);
      if (targetIndex !== undefined && targetIndex !== i) {
        uf.union(i, targetIndex);
        linkedIndices.add(i);
        linkedIndices.add(targetIndex);
      }
    }
  });

  const headerRoots = new Set();
  for (const i of linkedIndices) headerRoots.add(uf.find(i));

  const fallbackCandidateIndices = [];
  communications.forEach((c, i) => {
    if (!headerRoots.has(uf.find(i))) fallbackCandidateIndices.push(i);
  });

  const subjectBuckets = new Map();
  for (const i of fallbackCandidateIndices) {
    const norm = normalizeSubject(communications[i].subject);
    if (!subjectBuckets.has(norm)) subjectBuckets.set(norm, []);
    subjectBuckets.get(norm).push(i);
  }

  for (const [norm, indices] of subjectBuckets) {
    if (!norm) continue; // no subject at all -- can't fallback-group, stays singleton
    const participantSets = indices.map((i) => participantIdentifiers(communications[i]));
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        if (hasOverlap(participantSets[a], participantSets[b])) {
          uf.union(indices[a], indices[b]);
        }
      }
    }
  }

  const componentsByRoot = new Map();
  communications.forEach((c, i) => {
    const root = uf.find(i);
    if (!componentsByRoot.has(root)) componentsByRoot.set(root, []);
    componentsByRoot.get(root).push(i);
  });

  const threads = [];
  for (const [root, indices] of componentsByRoot) {
    const isHeaderThread = headerRoots.has(root);
    const members = indices.map((i) => communications[i]);
    const method = isHeaderThread ? 'header' : members.length > 1 ? 'subject-fallback' : 'singleton';
    threads.push(assembleThread(members, method));
  }

  threads.sort((a, b) => (a.dateRange.start ?? 0) - (b.dateRange.start ?? 0));
  return threads;
}
