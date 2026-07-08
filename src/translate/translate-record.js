import { translateText } from './translate.js';
import { appendEvent } from '../audit/audit-log.js';

const commStatementCache = new WeakMap();
function getCommStatement(db) {
  let stmt = commStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      UPDATE communications
      SET translatedText = @translatedText,
          translatedLang = @translatedLang,
          translatedAt = @translatedAt,
          translationMeta = @translationMeta
      WHERE id = @id
    `);
    commStatementCache.set(db, stmt);
  }
  return stmt;
}

const attachmentStatementCache = new WeakMap();
function getAttachmentStatement(db) {
  let stmt = attachmentStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      UPDATE attachments
      SET translatedText = @translatedText,
          translatedLang = @translatedLang,
          translatedAt = @translatedAt,
          translationMeta = @translationMeta
      WHERE id = @id
    `);
    attachmentStatementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Translates a communication's bodyText into English and writes the
 * result back, same "read row, call the engine, write result, log an
 * audit event" shape as src/db/extraction-write.js's
 * updateAttachmentExtraction(), but investigator-triggered per item
 * (see src/translate/translate.js -- there's no source-language
 * auto-detection in this codebase).
 */
export async function translateCommunication(db, communicationId, sourceLang) {
  const row = db.prepare('SELECT id, bodyText FROM communications WHERE id = ?').get(communicationId);
  if (!row) {
    throw new Error(`translateCommunication: no communication with id ${communicationId}`);
  }

  const result = await translateText(row.bodyText ?? '', sourceLang);
  getCommStatement(db).run({
    id: communicationId,
    translatedText: result.text,
    translatedLang: sourceLang,
    translatedAt: Date.now(),
    translationMeta: JSON.stringify(result.meta),
  });

  appendEvent(db, {
    eventType: 'translation_run',
    subjectRef: String(communicationId),
    payload: { target: 'communication', communicationId, sourceLang },
  });

  return result;
}

/**
 * Same as translateCommunication() but for an attachment's already-
 * extracted text (see src/extract/run-extraction.js) -- translating raw
 * attachment bytes directly is out of scope; only extracted/OCR'd text is
 * ever translated, mirroring how export-attachment only ever hands back
 * extracted text, never original bytes.
 */
export async function translateAttachment(db, attachmentId, sourceLang) {
  const row = db.prepare('SELECT id, extractedText FROM attachments WHERE id = ?').get(attachmentId);
  if (!row) {
    throw new Error(`translateAttachment: no attachment with id ${attachmentId}`);
  }

  const result = await translateText(row.extractedText ?? '', sourceLang);
  getAttachmentStatement(db).run({
    id: attachmentId,
    translatedText: result.text,
    translatedLang: sourceLang,
    translatedAt: Date.now(),
    translationMeta: JSON.stringify(result.meta),
  });

  appendEvent(db, {
    eventType: 'translation_run',
    subjectRef: String(attachmentId),
    payload: { target: 'attachment', attachmentId, sourceLang },
  });

  return result;
}
