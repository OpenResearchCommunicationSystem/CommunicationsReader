import { normalizeBody } from '../parser/body-normalize.js';
import { computeNormalizedHash } from '../parser/hash.js';
import { appendEvent } from '../audit/audit-log.js';

const BACKFILL_MARKER_KEY = 'normalizedHashSeparatorFixApplied';

/**
 * One-time data backfill for a real bug: computeNormalizedHash()
 * previously joined its parts with a literal NUL byte instead of a
 * space -- invisible in every editor/diff tool, discovered 2026-07-08.
 * Fixing the join character alone would silently desync dedup matching
 * between rows hashed before and after the fix (identical content would
 * hash differently depending on which algorithm computed it). Since
 * every input to the hash (bodyText/subject/fromRaw) is already stored
 * on each row, nothing is lost -- this recomputes normalizedHash for
 * every existing communications row with the corrected algorithm so old
 * and new rows converge onto the same value for the same content.
 *
 * Gated by an app_meta marker so it only ever runs once per DB, not on
 * every launch -- cheap to check (a single primary-key lookup) even once
 * the table has real data. Only logs an audit event when it actually
 * changes something, so an empty/fresh DB (every test DB, and any real
 * DB before its first import) doesn't get a no-op entry.
 */
export function backfillNormalizedHash(db) {
  const marker = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(BACKFILL_MARKER_KEY);
  if (marker) return { ran: false, updated: 0 };

  const rows = db.prepare(`SELECT id, subject, fromRaw, bodyText FROM communications`).all();
  const update = db.prepare(`UPDATE communications SET normalizedHash = ? WHERE id = ?`);

  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const normalizedBody = normalizeBody(row.bodyText);
      const normalizedHash = computeNormalizedHash(normalizedBody, { subject: row.subject, from: row.fromRaw });
      update.run(normalizedHash, row.id);
      updated++;
    }
    db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(BACKFILL_MARKER_KEY, new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (updated > 0) {
    appendEvent(db, { eventType: 'normalized_hash_backfill', payload: { updated } });
  }

  return { ran: true, updated };
}
