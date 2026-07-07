const statementCache = new WeakMap();

function getStatement(db) {
  let stmt = statementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      UPDATE attachments
      SET extractionStatus = @extractionStatus,
          extractionMethod = @extractionMethod,
          extractedText = @extractedText,
          extractionError = @extractionError,
          extractionMeta = @extractionMeta,
          extractedAt = @extractedAt
      WHERE id = @id
    `);
    statementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Writes the result of src/extract/attachment-extract.js's
 * extractAttachmentText() back onto an existing attachments row. A
 * separate, re-runnable pass over already-inserted attachments -- not
 * part of insertImportResult() -- since extraction (especially OCR) is
 * slow and must never block the import transaction.
 */
export function updateAttachmentExtraction(db, attachmentId, result) {
  getStatement(db).run({
    id: attachmentId,
    extractionStatus: result.status,
    extractionMethod: result.method ?? null,
    extractedText: result.text ?? null,
    extractionError: result.error ?? null,
    extractionMeta: result.meta ? JSON.stringify(result.meta) : null,
    extractedAt: Date.now(),
  });
}
