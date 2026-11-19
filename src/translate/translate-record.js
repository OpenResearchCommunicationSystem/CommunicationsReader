import { translateText } from './translate.js';
import { appendEvent } from '../audit/audit-log.js';
import { indexCommunicationTranslation, indexAttachmentTranslation } from '../search/token-index.js';

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
 * updateAttachmentExtraction(), but investigator-triggered per item.
 * translatedLang is whatever the AI itself detected (see
 * src/translate/translate.js) -- display-only, not a validated code.
 */
export async function translateCommunication(db, communicationId) {
  const row = db.prepare('SELECT id, bodyText FROM communications WHERE id = ?').get(communicationId);
  if (!row) {
    throw new Error(`translateCommunication: no communication with id ${communicationId}`);
  }

  const result = await translateText(row.bodyText ?? '');
  getCommStatement(db).run({
    id: communicationId,
    translatedText: result.text,
    translatedLang: result.meta.detectedLanguage || null,
    translatedAt: Date.now(),
    translationMeta: JSON.stringify(result.meta),
  });
  indexCommunicationTranslation(db, communicationId, result.text);

  appendEvent(db, {
    eventType: 'translation_run',
    subjectRef: String(communicationId),
    payload: { target: 'communication', communicationId, detectedLanguage: result.meta.detectedLanguage || null },
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
export async function translateAttachment(db, attachmentId) {
  const row = db.prepare('SELECT id, communicationId, extractedText FROM attachments WHERE id = ?').get(attachmentId);
  if (!row) {
    throw new Error(`translateAttachment: no attachment with id ${attachmentId}`);
  }

  const result = await translateText(row.extractedText ?? '');
  getAttachmentStatement(db).run({
    id: attachmentId,
    translatedText: result.text,
    translatedLang: result.meta.detectedLanguage || null,
    translatedAt: Date.now(),
    translationMeta: JSON.stringify(result.meta),
  });
  indexAttachmentTranslation(db, row.communicationId, attachmentId, result.text);

  appendEvent(db, {
    eventType: 'translation_run',
    subjectRef: String(attachmentId),
    payload: { target: 'attachment', attachmentId, detectedLanguage: result.meta.detectedLanguage || null },
  });

  return result;
}
