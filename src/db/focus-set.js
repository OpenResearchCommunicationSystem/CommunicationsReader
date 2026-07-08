import { listCommunications } from './query.js';

const insertStatementCache = new WeakMap();
function getInsertStatement(db) {
  let stmt = insertStatementCache.get(db);
  if (!stmt) {
    // INSERT OR IGNORE -- the UNIQUE(communicationId) constraint makes
    // re-adding an already-present member (individually, then again via
    // "add whole thread", or vice versa) a safe no-op rather than an error.
    stmt = db.prepare(`
      INSERT OR IGNORE INTO focus_set_members (communicationId, addedVia, addedAt, sourceNote)
      VALUES (@communicationId, @addedVia, @addedAt, @sourceNote)
    `);
    insertStatementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Adds one or more communications to the working focus set -- the
 * iteratively-built "pull this message, or this whole thread, out to
 * focus on" set described in this project's roadmap. addedVia is
 * 'manual' (a single message) or 'thread_expand' (every message in a
 * thread, added in one action); sourceNote is a free-form string for the
 * investigator's own record (e.g. the search query that led here).
 * Returns the number of newly-added rows (excludes already-present ids).
 */
export function addToFocusSet(db, communicationIds, { addedVia = 'manual', sourceNote = null } = {}) {
  const stmt = getInsertStatement(db);
  const addedAt = Date.now();
  let added = 0;
  for (const communicationId of communicationIds) {
    const res = stmt.run({ communicationId, addedVia, addedAt, sourceNote });
    if (res.changes > 0) added++;
  }
  return added;
}

/**
 * Removes one or more communications from the focus set. Safe to call
 * with ids that aren't currently members.
 */
export function removeFromFocusSet(db, communicationIds) {
  if (!Array.isArray(communicationIds) || communicationIds.length === 0) return 0;
  const placeholders = communicationIds.map(() => '?').join(', ');
  const res = db.prepare(`DELETE FROM focus_set_members WHERE communicationId IN (${placeholders})`).run(...communicationIds);
  return res.changes;
}

/**
 * Empties the entire focus set.
 */
export function clearFocusSet(db) {
  const res = db.prepare('DELETE FROM focus_set_members').run();
  return res.changes;
}

/**
 * Returns the current focus set as full communication rows (with
 * participants/attachments attached, same shape as query.js's other
 * listing functions), ordered by when each was added.
 */
export function listFocusSet(db) {
  const memberRows = db.prepare('SELECT communicationId FROM focus_set_members ORDER BY addedAt ASC').all();
  const ids = memberRows.map((r) => r.communicationId);
  if (ids.length === 0) return [];
  const byId = new Map(listCommunications(db, { ids }).map((c) => [c.id, c]));
  // Preserve add-order (listCommunications orders by timestamp, not
  // addedAt) and silently drop any id whose row no longer exists (e.g. the
  // dataset it belonged to was deleted -- ON DELETE CASCADE already
  // removed the focus_set_members row too, but guard anyway).
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Lightweight count for a UI badge -- avoids fetching full rows just to
 * show "N in focus".
 */
export function getFocusSetCount(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM focus_set_members').get().c;
}
