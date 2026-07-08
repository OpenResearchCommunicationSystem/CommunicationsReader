import { indexCommunicationText, indexAttachmentText } from '../search/token-index.js';

const BACKFILL_MARKER_KEY = 'tokenIndexBackfillApplied';

/**
 * One-time backfill: token_index (S3) is populated going forward by
 * src/db/insert.js (communications) and src/extract/run-extraction.js
 * (attachment text), but a DB created by a build before S3 shipped has
 * real rows with no index entries at all. Without this, every one of
 * those rows would be silently unsearchable once candidate-narrowing
 * (src/search/candidate-narrow.js) is live -- narrowing is only safe
 * when the index is actually complete, and it's easy to end up in a
 * state where it isn't (the same class of gap the S1 attachments-
 * columns migration bug was, caught the same way: by asking "what
 * happens to data that already exists"). Indexes every existing
 * communication's subject/body/from/to and every attachment that
 * already succeeded extraction. Gated by an app_meta marker so it runs
 * exactly once per DB.
 */
export function backfillTokenIndex(db) {
  const marker = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(BACKFILL_MARKER_KEY);
  if (marker) return { ran: false, indexedCommunications: 0, indexedAttachments: 0 };

  const communications = db.prepare(`SELECT id, subject, bodyText, fromRaw, toRaw FROM communications`).all();
  const attachments = db
    .prepare(
      `SELECT id, communicationId, extractedText FROM attachments
       WHERE extractionStatus = 'attempted_succeeded' AND extractedText IS NOT NULL`
    )
    .all();

  db.exec('BEGIN');
  try {
    for (const c of communications) {
      indexCommunicationText(db, c);
    }
    for (const a of attachments) {
      indexAttachmentText(db, a.communicationId, a.id, a.extractedText);
    }
    db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(BACKFILL_MARKER_KEY, new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { ran: true, indexedCommunications: communications.length, indexedAttachments: attachments.length };
}
