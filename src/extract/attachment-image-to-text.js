import { extractAttachmentText } from './attachment-extract.js';
import { classifyAttachment } from './index.js';
import { updateAttachmentExtraction } from '../db/extraction-write.js';
import { indexAttachmentText } from '../search/token-index.js';
import { appendEvent } from '../audit/audit-log.js';

/**
 * Runs AI image-to-text on exactly one attachment, on demand -- the
 * single-item counterpart to run-extraction.js's dataset-wide batch.
 * Confirmed necessary directly (2026-11): the dataset-level "Re-run OCR"
 * button force-re-ran extraction across an ENTIRE dataset (every
 * attachment, not just images) with no preview or confirmation step --
 * exactly the kind of uncontrolled bulk AI action this project's house
 * rule exists to prevent elsewhere (see translate-batch.js). Removed
 * rather than fixed in place: a single clearly-labeled per-file action,
 * triggered from the attachment the investigator is actually looking
 * at, is what was actually wanted, not a safer bulk one.
 *
 * Throws only for a programmer-error-shaped input (no such attachment,
 * or not image-kind at all -- this is "Image to Text", not general
 * re-extraction; docx/xlsx/pptx/pdf are handled by the deterministic,
 * non-AI pipeline automatically at import time). A real extraction
 * failure/rejection is NOT thrown -- same as extractAttachmentText's own
 * contract -- it's written to the attachment row as
 * attempted_failed/not_attempted and returned for the UI to show inline.
 */
export async function imageToText(db, attachmentId) {
  const row = db
    .prepare('SELECT id, communicationId, filename, mimeType, savedPath, contentHash FROM attachments WHERE id = ?')
    .get(attachmentId);
  if (!row) {
    throw new Error(`imageToText: no attachment with id ${attachmentId}`);
  }
  if (classifyAttachment(row) !== 'image') {
    throw new Error(`imageToText: attachment ${attachmentId} (${row.filename}) is not an image`);
  }

  const result = await extractAttachmentText(row);
  updateAttachmentExtraction(db, attachmentId, result);
  if (result.status === 'attempted_succeeded') {
    indexAttachmentText(db, row.communicationId, attachmentId, result.text);
  }

  appendEvent(db, {
    eventType: 'image_to_text_run',
    subjectRef: String(attachmentId),
    payload: { attachmentId, filename: row.filename, status: result.status },
  });

  return result;
}
