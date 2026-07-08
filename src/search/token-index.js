import { tokenize } from './tokenize.js';

const insertStmtCache = new WeakMap();
function getInsertStatement(db) {
  let stmt = insertStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO token_index (communicationId, attachmentId, fieldKind, token, tokenPosition)
      VALUES (@communicationId, @attachmentId, @fieldKind, @token, @tokenPosition)
    `);
    insertStmtCache.set(db, stmt);
  }
  return stmt;
}

function indexField(db, communicationId, attachmentId, fieldKind, text) {
  if (!text) return;
  const stmt = getInsertStatement(db);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    stmt.run({ communicationId, attachmentId, fieldKind, token: tokens[i].text.toLowerCase(), tokenPosition: i });
  }
}

/**
 * Indexes a communication's own text fields (subject/body/from/to) into
 * token_index -- called once at insert time (src/db/insert.js).
 * Attachment text is indexed separately (see indexAttachmentText) once
 * extraction actually produces it, which happens later/asynchronously.
 */
export function indexCommunicationText(db, { id, subject, bodyText, fromRaw, toRaw }) {
  indexField(db, id, null, 'subject', subject);
  indexField(db, id, null, 'body', bodyText);
  indexField(db, id, null, 'from', fromRaw);
  indexField(db, id, null, 'to', toRaw);
}

/**
 * Indexes one attachment's extracted text. Deletes any prior entries for
 * this attachment first, so re-extraction (force: true, e.g. after a
 * library upgrade) never leaves stale/duplicate index rows behind.
 * Callers must never call this for a quarantineStatus='rejected'
 * attachment -- there's no legitimate text to index, and indexing
 * anything derived from a rejected file defeats the point of rejecting
 * it (see src/extract/run-extraction.js).
 */
export function indexAttachmentText(db, communicationId, attachmentId, extractedText) {
  db.prepare('DELETE FROM token_index WHERE attachmentId = ?').run(attachmentId);
  indexField(db, communicationId, attachmentId, 'attachment_text', extractedText);
}
