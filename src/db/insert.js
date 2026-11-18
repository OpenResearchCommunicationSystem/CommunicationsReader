import { mapEmailMessageToCommunication } from './map-email.js';
import { indexCommunicationText, indexAttachmentFilename } from '../search/token-index.js';

// Messages are committed in batches rather than one all-or-nothing
// transaction, so an interruption (the laptop losing power or being
// forced to sleep mid-import, a real-world operating constraint) never
// loses more than one batch's worth of work -- see
// insertImportResult()'s resumability design below.
const IMPORT_BATCH_SIZE = 500;

// Dedup policy (the reason this file looks the way it does):
//
// - rawHash match WITHIN the same dataset: a true exact-duplicate (the
//   identical bytes appeared twice in one import). Never skipped --
//   inserted like any other row -- and surfaced as a query-time signal via
//   query.js's getDedupGroups(), not enforced here at insert time.
// - rawHash match ACROSS different datasets: expected and unremarkable
//   (e.g. the same mailbox exported twice). Rows from both datasets are
//   preserved; no special handling.
// - normalizedHash match (within OR across datasets): the "same content,
//   different envelope" signal -- this is exactly the real-world case
//   observed between two separate test archives containing the same
//   underlying messages with differing headers. Never skipped or merged
//   at insert time; every row from every dataset is always inserted, full
//   provenance preserved (a forensic tool needs to know content showed up
//   in multiple sources, not have that collapsed away). Surfaced via
//   query.js's getDedupGroups() as cross-dataset groups.
// - Nothing is ever silently dropped by dedup logic. The only rows absent
//   from the DB are messages that failed to parse (Milestone 1's
//   importArchive().failures[]) or failed to insert (recorded below in
//   insertFailures[]).

const statementCache = new WeakMap();

function getStatements(db) {
  let cached = statementCache.get(db);
  if (cached) return cached;

  cached = {
    insertDataset: db.prepare(`
      INSERT INTO datasets (
        sourceType, label, originalPath, importedAt, containerType,
        succeededCount, failedCount, totalCount, note, importerVersion, attachmentsDir
      ) VALUES (
        @sourceType, @label, @originalPath, @importedAt, @containerType,
        @succeededCount, @failedCount, @totalCount, @note, @importerVersion, @attachmentsDir
      )
    `),
    insertCommunication: db.prepare(`
      INSERT INTO communications (
        datasetId, sourceType, commType, timestamp, durationSeconds,
        subject, bodyText, bodyHtml, bodyEmpty,
        fromRaw, toRaw, ccRaw, direction,
        threadId, messageId, inReplyTo, referencesJson,
        rawHash, normalizedHash, encodingUncertain, charsetOverridden,
        sourceRef, sourceSpecific, createdAt
      ) VALUES (
        @datasetId, @sourceType, @commType, @timestamp, @durationSeconds,
        @subject, @bodyText, @bodyHtml, @bodyEmpty,
        @fromRaw, @toRaw, @ccRaw, @direction,
        @threadId, @messageId, @inReplyTo, @referencesJson,
        @rawHash, @normalizedHash, @encodingUncertain, @charsetOverridden,
        @sourceRef, @sourceSpecific, @createdAt
      )
    `),
    insertParticipant: db.prepare(`
      INSERT INTO participants (communicationId, role, identifier, displayName, sortOrder)
      VALUES (@communicationId, @role, @identifier, @displayName, @sortOrder)
    `),
    insertAttachment: db.prepare(`
      INSERT INTO attachments (communicationId, filename, size, mimeType, savedPath, contentHash)
      VALUES (@communicationId, @filename, @size, @mimeType, @savedPath, @contentHash)
    `),
    getImportProgress: db.prepare(`SELECT * FROM import_progress WHERE archiveSha256 = ?`),
    upsertImportProgressStart: db.prepare(`
      INSERT INTO import_progress (archiveSha256, datasetId, lastProcessedIndex, totalCount, status, updatedAt)
      VALUES (@archiveSha256, @datasetId, -1, @totalCount, 'in_progress', @updatedAt)
      ON CONFLICT(archiveSha256) DO UPDATE SET
        datasetId = excluded.datasetId, lastProcessedIndex = -1, totalCount = excluded.totalCount,
        status = 'in_progress', updatedAt = excluded.updatedAt
    `),
    updateImportProgress: db.prepare(`
      UPDATE import_progress SET lastProcessedIndex = ?, updatedAt = ? WHERE archiveSha256 = ?
    `),
    completeImportProgress: db.prepare(`
      UPDATE import_progress SET status = 'completed', updatedAt = ? WHERE archiveSha256 = ?
    `),
    countCommunicationsForDataset: db.prepare(`SELECT COUNT(*) AS c FROM communications WHERE datasetId = ?`),
  };

  statementCache.set(db, cached);
  return cached;
}

/**
 * Inserts a single datasets row. Returns the new dataset's id.
 */
export function insertDataset(db, meta) {
  const stmts = getStatements(db);
  const res = stmts.insertDataset.run({
    sourceType: meta.sourceType,
    label: meta.label ?? null,
    originalPath: meta.originalPath,
    importedAt: Date.now(),
    containerType: meta.containerType ?? null,
    succeededCount: meta.succeededCount ?? 0,
    failedCount: meta.failedCount ?? 0,
    totalCount: meta.totalCount ?? 0,
    note: meta.note ?? null,
    importerVersion: meta.importerVersion ?? null,
    attachmentsDir: meta.attachmentsDir ?? null,
  });
  return Number(res.lastInsertRowid);
}

function insertCommunication(db, communication) {
  const stmts = getStatements(db);
  const res = stmts.insertCommunication.run(communication);
  return Number(res.lastInsertRowid);
}

function insertParticipants(db, communicationId, participants) {
  const stmts = getStatements(db);
  for (const p of participants) {
    stmts.insertParticipant.run({
      communicationId,
      role: p.role,
      identifier: p.identifier,
      displayName: p.displayName ?? null,
      sortOrder: p.sortOrder ?? 0,
    });
  }
}

function insertAttachments(db, communicationId, attachments) {
  const stmts = getStatements(db);
  for (const a of attachments) {
    const res = stmts.insertAttachment.run({
      communicationId,
      filename: a.filename ?? null,
      size: a.size ?? null,
      mimeType: a.mimeType ?? null,
      savedPath: a.savedPath ?? null,
      contentHash: a.contentHash ?? null,
    });
    // Filename is known immediately, regardless of whether extraction
    // ever runs or succeeds (an image, a legacy .doc this app never
    // attempts, a rejected/quarantined file) -- indexed right here, not
    // left to piggyback on extraction succeeding.
    if (a.filename) {
      indexAttachmentFilename(db, communicationId, Number(res.lastInsertRowid), a.filename);
    }
  }
}

/**
 * Inserts the full output of parser/index.js's importArchive() as one new
 * dataset (or continues an interrupted one -- see below). One malformed/
 * impossible message never aborts the batch -- its failure is recorded in
 * insertFailures and the batch continues, mirroring importArchive()'s own
 * defensive per-message handling.
 *
 * Commits happen in batches of IMPORT_BATCH_SIZE, not one all-or-nothing
 * transaction: if the process is interrupted mid-import, only the
 * in-progress batch is lost, not everything already committed.
 *
 * Resumability: pass meta.archiveSha256 (electron/main.js already computes
 * this for the S2 audit log) to enable it. On a fresh archive, a new
 * import_progress row is created and updated after every committed batch.
 * If the SAME archive hash is passed again while its import_progress
 * status is still 'in_progress' (the prior run never reached the end --
 * process died, laptop lost power, etc.), this resumes from the last
 * committed batch boundary into the SAME dataset row, re-parsing the
 * archive (parsing itself isn't checkpointed -- it's comparatively fast
 * next to insert+extract+OCR) but skipping every message index already
 * committed. Once status is 'completed', re-passing that hash is treated
 * as an intentional fresh re-import (a new dataset), not a resume --
 * this app already supports "the same archive imported twice" as a
 * normal, expected case (see the dedup policy comment above).
 *
 * meta: { sourceType, originalPath, label?, importerVersion?,
 * attachmentsDir?, archiveSha256? }
 *
 * Returns { datasetId, insertedCount, insertFailures }.
 */
export function insertImportResult(db, importResult, meta) {
  const stmts = getStatements(db);
  const archiveSha256 = meta.archiveSha256 ?? null;
  const messages = importResult.messages;

  const existingProgress = archiveSha256 ? stmts.getImportProgress.get(archiveSha256) : null;
  const resuming = Boolean(existingProgress && existingProgress.status === 'in_progress');

  let datasetId;
  let startIndex;
  if (resuming) {
    datasetId = existingProgress.datasetId;
    startIndex = existingProgress.lastProcessedIndex + 1;
  } else {
    datasetId = insertDataset(db, {
      sourceType: meta.sourceType,
      label: meta.label,
      originalPath: meta.originalPath,
      containerType: importResult.containerType,
      succeededCount: importResult.summary.succeeded,
      failedCount: importResult.summary.failed,
      totalCount: importResult.summary.total,
      note: importResult.note,
      importerVersion: meta.importerVersion,
      attachmentsDir: meta.attachmentsDir,
    });
    startIndex = 0;
    if (archiveSha256) {
      stmts.upsertImportProgressStart.run({
        archiveSha256,
        datasetId,
        totalCount: messages.length,
        updatedAt: Date.now(),
      });
    }
  }

  const insertFailures = [];
  let insertedCount = resuming ? stmts.countCommunicationsForDataset.get(datasetId).c : 0;

  for (let batchStart = startIndex; batchStart < messages.length; batchStart += IMPORT_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + IMPORT_BATCH_SIZE, messages.length);
    db.exec('BEGIN');
    try {
      for (let i = batchStart; i < batchEnd; i++) {
        const message = messages[i];
        try {
          const { communication, participants, attachments } = mapEmailMessageToCommunication(message, datasetId);
          const communicationId = insertCommunication(db, communication);
          insertParticipants(db, communicationId, participants);
          insertAttachments(db, communicationId, attachments);
          indexCommunicationText(db, { id: communicationId, ...communication });
          insertedCount++;
        } catch (err) {
          insertFailures.push({ sourceInfo: message.sourceInfo, error: err.message });
        }
      }
      if (archiveSha256) {
        stmts.updateImportProgress.run(batchEnd - 1, Date.now(), archiveSha256);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  if (archiveSha256) {
    stmts.completeImportProgress.run(Date.now(), archiveSha256);
  }

  return { datasetId, insertedCount, insertFailures };
}
