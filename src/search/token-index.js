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
  db.prepare(`DELETE FROM token_index WHERE attachmentId = ? AND fieldKind = 'attachment_text'`).run(attachmentId);
  indexField(db, communicationId, attachmentId, 'attachment_text', extractedText);
}

/**
 * Indexes one attachment's filename -- called once at insert time (see
 * src/db/insert.js), for EVERY attachment regardless of whether
 * extraction ever succeeds (or even runs at all, e.g. an image, or a
 * legacy .doc/.xls this app never attempts). The filename is known
 * immediately at parse time; it shouldn't take a successful text
 * extraction for "find the message with invoice.pdf attached" to work.
 * A separate fieldKind from indexAttachmentText's 'attachment_text', so
 * re-extraction (which deletes and re-indexes only 'attachment_text')
 * never touches this.
 */
export function indexAttachmentFilename(db, communicationId, attachmentId, filename) {
  indexField(db, communicationId, attachmentId, 'attachment_filename', filename);
}

/**
 * Indexes a communication's body translation -- called from
 * src/translate/translate-record.js's translateCommunication() right
 * after it writes translatedText. Without this, an investigator who
 * translates a Farsi email to English still can't search for the
 * English text, only the untranslated original -- confirmed a real gap,
 * not a hypothetical one. Deletes any prior entry first (re-translating
 * the same item, e.g. after picking a different source language, must
 * never leave a stale copy of the old translation searchable).
 */
export function indexCommunicationTranslation(db, communicationId, translatedText) {
  db.prepare(`DELETE FROM token_index WHERE communicationId = ? AND attachmentId IS NULL AND fieldKind = 'body_translation'`).run(communicationId);
  indexField(db, communicationId, null, 'body_translation', translatedText);
}

/**
 * Same as indexCommunicationTranslation() but for an attachment's
 * translated (extracted or OCR'd) text.
 */
export function indexAttachmentTranslation(db, communicationId, attachmentId, translatedText) {
  db.prepare(`DELETE FROM token_index WHERE attachmentId = ? AND fieldKind = 'attachment_translation'`).run(attachmentId);
  indexField(db, communicationId, attachmentId, 'attachment_translation', translatedText);
}
