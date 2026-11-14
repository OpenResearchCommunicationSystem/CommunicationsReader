import { extractAttachmentText } from './attachment-extract.js';
import { classifyAttachment } from './index.js';
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
 * Byte-identical attachments (the same signature image or contract PDF
 * forwarded to many recipients -- extremely common in real mailboxes) are
 * extracted/OCR'd only once per batch: rows are grouped by contentHash +
 * classified kind (not contentHash alone -- two rows can share bytes but
 * claim different types via a mislabeled filename/mimeType, and
 * classifyAttachment()'s kind is what actually selects the extractor and
 * gates the magic-byte verification, so mixing kinds here would let a
 * mislabeled row silently inherit another row's verification result).
 * Every row in a group still gets its own DB write, quarantine audit
 * event, and search-index entry -- only the expensive
 * extractAttachmentText() call itself is shared, mirroring insert.js's
 * "never silently drop a row" dedup policy.
 *
 * options: { datasetIds?: number[], force?: boolean, langs?: string[],
 * includeImages?: boolean } -- force re-runs extraction even for
 * attachments already attempted (e.g. after a library upgrade). langs
 * selects which language hint OCR runs with for this call (see ocr.js's
 * AVAILABLE_LANGS); defaults to ocr.js's own DEFAULT_LANGS when omitted.
 * Non-image extractors ignore it.
 *
 * includeImages (default true) gates the ONLY AI-backed extractor in this
 * pipeline (see ocr.js -- images now go through a paid AI endpoint, not
 * bundled Tesseract). docx/xlsx/pptx/pdf-text-layer extraction is fully
 * deterministic/local and always runs regardless of this flag.
 * electron/main.js's import-archive and import-autopsy-case handlers
 * MUST always pass includeImages: false -- confirmed directly by the
 * investigator (2026-11): OCR must never auto-run on import, at any
 * scale, full stop, since it now costs real money per call and a case
 * can hold hundreds of thousands of images. Images left out this way
 * stay extractedAt: NULL (not a terminal state), so they're still picked
 * up whenever the investigator explicitly triggers OCR later (the
 * 'run-extraction' IPC handler, called with includeImages left at its
 * true default) -- this is the ONLY path that may ever reach the AI
 * endpoint for OCR.
 *
 * Returns { attempted, succeeded, failed, deduped }.
 */
export async function runExtraction(db, options = {}) {
  const { datasetIds, force = false, langs, includeImages = true } = options;

  let sql = `
    SELECT a.id, a.communicationId, a.filename, a.mimeType, a.savedPath, a.contentHash
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

  // Filtered up front (not just skipped when grouping) so `rows.length`
  // below -- used for both the returned `attempted` count and the audit
  // log payload -- never counts an image this call deliberately never
  // touched as "attempted".
  const rows = db.prepare(sql).all(...params).filter((row) => includeImages || classifyAttachment(row) !== 'image');

  const groups = new Map();
  for (const row of rows) {
    const kind = classifyAttachment(row);
    const key = row.contentHash ? `${row.contentHash}::${kind}` : `row:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let succeeded = 0;
  let failed = 0;
  let quarantined = 0;
  let deduped = 0;

  try {
    for (const group of groups.values()) {
      const [representative] = group;
      let result;
      try {
        result = await extractAttachmentText(representative, { langs });
      } catch (err) {
        // extractAttachmentText contracts to never throw, but guard the
        // batch loop anyway (belt-and-suspenders, same as insert.js).
        result = { status: 'attempted_failed', method: null, text: null, error: err.message, meta: null };
      }

      for (const row of group) {
        const isDuplicate = row !== representative;
        const writtenResult = isDuplicate
          ? { ...result, meta: { ...(result.meta ?? {}), dedupedFromAttachmentId: representative.id } }
          : result;
        updateAttachmentExtraction(db, row.id, writtenResult);
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
        if (isDuplicate) deduped++;
      }
    }
  } finally {
    await terminateOcrWorker();
  }

  appendEvent(db, {
    eventType: 'extraction_run',
    subjectRef: Array.isArray(datasetIds) ? datasetIds.join(',') : null,
    payload: { datasetIds: datasetIds ?? null, force, attempted: rows.length, succeeded, failed, quarantined, deduped },
  });

  return { attempted: rows.length, succeeded, failed, deduped };
}
