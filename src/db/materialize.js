import path from 'node:path';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { openDatabase } from './schema.js';
import { insertDataset } from './insert.js';
import { appendEvent } from '../audit/audit-log.js';

const COMMUNICATION_COLUMNS = [
  'sourceType', 'commType', 'timestamp', 'durationSeconds',
  'subject', 'bodyText', 'bodyHtml', 'bodyEmpty',
  'fromRaw', 'toRaw', 'ccRaw', 'direction',
  'threadId', 'messageId', 'inReplyTo', 'referencesJson',
  'rawHash', 'normalizedHash', 'encodingUncertain', 'charsetOverridden',
  'sourceRef', 'sourceSpecific', 'createdAt',
];

const PARTICIPANT_COLUMNS = ['role', 'identifier', 'displayName', 'sortOrder'];

const ATTACHMENT_COLUMNS = [
  'filename', 'size', 'mimeType', 'savedPath', 'contentHash',
  'extractionStatus', 'extractionMethod', 'extractedText', 'extractionError', 'extractionMeta', 'extractedAt',
  'quarantineStatus', 'quarantineReason',
];

function insertRaw(db, table, columns, valuesByColumn) {
  const placeholders = columns.map(() => '?').join(', ');
  const res = db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...columns.map((c) => valuesByColumn[c] ?? null));
  return Number(res.lastInsertRowid);
}

/**
 * Materializes the current focus set (src/db/focus-set.js) into a new,
 * standalone SQLite file + attachments directory under outputDir --
 * "pull these threads out so I can focus" as an actual portable
 * artifact, not just an in-app view. The original raw archive and
 * primary DB are never modified by this operation (read-only against
 * `db`, all writes go to the new file).
 *
 * Attachments are deduplicated by contentHash: if the focus set contains
 * the same file referenced from many messages (the same image forwarded
 * 40 times, say), the bytes are copied to disk exactly once -- every
 * attachment row is still preserved individually (so which message
 * carried which copy is never lost), they just all point at the one
 * shared file.
 *
 * Throws if the focus set is empty. Returns a summary and logs a
 * materialization_created audit event on the SOURCE db.
 */
export function materializeFocusSet(db, outputDir) {
  const memberIds = db.prepare('SELECT communicationId FROM focus_set_members').all().map((r) => r.communicationId);
  if (memberIds.length === 0) {
    throw new Error('Focus set is empty -- add at least one message or thread before exporting.');
  }

  // Raw rows (not query.js's listCommunications, which boolify()s three
  // columns for renderer convenience -- SQLite wants the original 0/1
  // integers back on insert, not JS booleans).
  const placeholders = memberIds.map(() => '?').join(', ');
  const communications = db.prepare(`SELECT * FROM communications WHERE id IN (${placeholders})`).all(...memberIds);
  const participants = db.prepare(`SELECT * FROM participants WHERE communicationId IN (${placeholders})`).all(...memberIds);
  const attachments = db.prepare(`SELECT * FROM attachments WHERE communicationId IN (${placeholders})`).all(...memberIds);

  const datasetIds = [...new Set(communications.map((c) => c.datasetId))];
  const datasetPlaceholders = datasetIds.map(() => '?').join(', ');
  const datasets = db.prepare(`SELECT * FROM datasets WHERE id IN (${datasetPlaceholders})`).all(...datasetIds);

  mkdirSync(outputDir, { recursive: true });
  const outAttachmentsDir = path.join(outputDir, 'attachments');
  mkdirSync(outAttachmentsDir, { recursive: true });
  const outDbPath = path.join(outputDir, 'focus-set.db');
  const outDb = openDatabase(outDbPath);

  try {
    const datasetIdMap = new Map();
    for (const d of datasets) {
      const newId = insertDataset(outDb, {
        sourceType: d.sourceType,
        label: d.label ? `${d.label} (focus set)` : 'focus set',
        originalPath: d.originalPath,
        containerType: d.containerType,
        note: 'Materialized from a focus set -- see this DB\'s creation context in the source app\'s audit log.',
        importerVersion: d.importerVersion,
      });
      datasetIdMap.set(d.id, newId);
    }

    const commIdMap = new Map();
    for (const c of communications) {
      const newId = insertRaw(outDb, 'communications', ['datasetId', ...COMMUNICATION_COLUMNS], {
        ...c,
        datasetId: datasetIdMap.get(c.datasetId),
      });
      commIdMap.set(c.id, newId);
    }

    for (const p of participants) {
      insertRaw(outDb, 'participants', ['communicationId', ...PARTICIPANT_COLUMNS], {
        ...p,
        communicationId: commIdMap.get(p.communicationId),
      });
    }

    const copiedPathByHash = new Map();
    let uniqueFiles = 0;
    for (const a of attachments) {
      let newSavedPath = null;
      if (a.savedPath) {
        const dedupKey = a.contentHash || `att-${a.id}`; // no hash (pre-S1 row) -- never dedup, copy its own file
        if (copiedPathByHash.has(dedupKey)) {
          newSavedPath = copiedPathByHash.get(dedupKey);
        } else {
          const ext = path.extname(a.savedPath);
          newSavedPath = path.join(outAttachmentsDir, `${dedupKey}${ext}`);
          if (!existsSync(newSavedPath)) {
            copyFileSync(a.savedPath, newSavedPath);
            uniqueFiles++;
          }
          copiedPathByHash.set(dedupKey, newSavedPath);
        }
      }
      insertRaw(outDb, 'attachments', ['communicationId', ...ATTACHMENT_COLUMNS], {
        ...a,
        communicationId: commIdMap.get(a.communicationId),
        savedPath: newSavedPath,
      });
    }

    const summary = {
      outputDir,
      datasetCount: datasets.length,
      communicationCount: communications.length,
      totalAttachmentReferences: attachments.length,
      uniqueFiles,
      duplicatesSaved: attachments.length - uniqueFiles,
    };

    appendEvent(db, { eventType: 'materialization_created', subjectRef: outputDir, payload: summary });

    return summary;
  } finally {
    outDb.close();
  }
}
