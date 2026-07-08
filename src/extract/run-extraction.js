import { extractAttachmentText } from './attachment-extract.js';
import { updateAttachmentExtraction } from '../db/extraction-write.js';
import { terminateOcrWorker } from './ocr.js';
import { appendEvent } from '../audit/audit-log.js';
import { indexAttachmentText } from '../search/token-index.js';

/**
 * Runs text extraction over every attachment with extractionStatus =
 * 'not_attempted' (the default for newly-inserted attachments), writing
 * each result back immediately so partial progress survives a mid-batch
 * interruption (important since OCR is slow). Never aborts on one
 * attachment's failure -- mirrors importArchive()'s defensive per-item
 * loop.
 *
 * options: { datasetIds?: number[], force?: boolean } -- force re-runs
 * extraction even for attachments already attempted (e.g. after a library
 * upgrade).
 *
 * Returns { attempted, succeeded, failed }.
 */
export async function runExtraction(db, options = {}) {
  const { datasetIds, force = false } = options;

  let sql = `
    SELECT a.id, a.communicationId, a.filename, a.mimeType, a.savedPath
    FROM attachments a
    JOIN communications c ON c.id = a.communicationId
  `;
  const params = [];
  // A previously rejected attachment (claimed-vs-actual content mismatch,
  // or a size/complexity limit exceeded) is never retried, even under
  // force: true -- it's been confirmed unsafe to hand to an extractor,
  // not merely "not attempted yet".
  const conditions = [`a.quarantineStatus != 'rejected'`];

  if (!force) {
    // extractedAt (not extractionStatus) is the "have we run the pipeline
    // on this row yet" marker -- extractionStatus's 'not_attempted' value
    // is also the terminal state for unsupported types, so filtering on
    // it here would re-select unsupported attachments on every run.
    conditions.push('a.extractedAt IS NULL');
  }
  if (Array.isArray(datasetIds) && datasetIds.length > 0) {
    conditions.push(`c.datasetId IN (${datasetIds.map(() => '?').join(', ')})`);
    params.push(...datasetIds);
  }
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const rows = db.prepare(sql).all(...params);

  let succeeded = 0;
  let failed = 0;
  let quarantined = 0;

  try {
    for (const row of rows) {
      try {
        const result = await extractAttachmentText(row);
        updateAttachmentExtraction(db, row.id, result);
        if (result.status === 'attempted_succeeded') {
          succeeded++;
          indexAttachmentText(db, row.communicationId, row.id, result.text);
        }
        if (result.status === 'attempted_failed') failed++;
        // Quarantine/rejection is forensically significant on its own --
        // logged separately from the extraction_run summary below so a
        // reviewer scanning the audit log for attachment_quarantined
        // events doesn't have to cross-reference batch run summaries.
        if (result.quarantineStatus === 'rejected') {
          quarantined++;
          appendEvent(db, {
            eventType: 'attachment_quarantined',
            subjectRef: String(row.id),
            payload: { attachmentId: row.id, filename: row.filename, quarantineReason: result.quarantineReason },
          });
        }
      } catch (err) {
        // extractAttachmentText contracts to never throw, but guard the
        // batch loop anyway (belt-and-suspenders, same as insert.js).
        updateAttachmentExtraction(db, row.id, {
          status: 'attempted_failed',
          method: null,
          text: null,
          error: err.message,
          meta: null,
        });
        failed++;
      }
    }
  } finally {
    await terminateOcrWorker();
  }

  appendEvent(db, {
    eventType: 'extraction_run',
    subjectRef: Array.isArray(datasetIds) ? datasetIds.join(',') : null,
    payload: { datasetIds: datasetIds ?? null, force, attempted: rows.length, succeeded, failed, quarantined },
  });

  return { attempted: rows.length, succeeded, failed };
}
