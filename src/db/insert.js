import { mapEmailMessageToCommunication } from './map-email.js';

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
      INSERT INTO attachments (communicationId, filename, size, mimeType, savedPath)
      VALUES (@communicationId, @filename, @size, @mimeType, @savedPath)
    `),
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
    stmts.insertAttachment.run({
      communicationId,
      filename: a.filename ?? null,
      size: a.size ?? null,
      mimeType: a.mimeType ?? null,
      savedPath: a.savedPath ?? null,
    });
  }
}

/**
 * Inserts the full output of parser/index.js's importArchive() as one new
 * dataset. One malformed/impossible message never aborts the whole
 * import -- its failure is recorded in insertFailures and the batch
 * continues, mirroring importArchive()'s own defensive per-message
 * handling.
 *
 * meta: { sourceType, originalPath, label?, importerVersion?, attachmentsDir? }
 *
 * Returns { datasetId, insertedCount, insertFailures }.
 */
export function insertImportResult(db, importResult, meta) {
  const datasetId = insertDataset(db, {
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

  const insertFailures = [];
  let insertedCount = 0;

  db.exec('BEGIN');
  try {
    for (const message of importResult.messages) {
      try {
        const { communication, participants, attachments } = mapEmailMessageToCommunication(message, datasetId);
        const communicationId = insertCommunication(db, communication);
        insertParticipants(db, communicationId, participants);
        insertAttachments(db, communicationId, attachments);
        insertedCount++;
      } catch (err) {
        insertFailures.push({ sourceInfo: message.sourceInfo, error: err.message });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { datasetId, insertedCount, insertFailures };
}
