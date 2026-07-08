import { createHash } from 'node:crypto';

// This log is operational record-keeping for malware containment, case
// compartmentalization, and the analyst's own reference -- it is NOT a
// chain-of-custody or evidentiary system and makes no legal claims.
// Court-usable evidence and legal chain of custody are established
// separately by case agents and forensic teams, using their own
// procedures; this tool exists to help identify leads for that
// downstream process, not to replace it.

// Explicit key order (not a generic canonicalizer) -- this is the only
// place that ever builds the string that gets hashed, so a fixed literal
// shape is enough to guarantee two calls with the same field values
// always hash the same way.
function canonicalRecordString({ sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash }) {
  return JSON.stringify({ sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash });
}

function computeRecordHash(fields) {
  return createHash('sha256').update(canonicalRecordString(fields)).digest('hex');
}

function getLastRecord(db) {
  return db.prepare('SELECT * FROM audit_log ORDER BY sequenceNumber DESC LIMIT 1').get() ?? null;
}

const insertStatementCache = new WeakMap();
function getInsertStatement(db) {
  let stmt = insertStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO audit_log (sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash, recordHash)
      VALUES (@sequenceNumber, @timestampUtc, @eventType, @subjectRef, @payloadJson, @prevRecordHash, @recordHash)
    `);
    insertStatementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Appends one event to the hash-chained audit log. eventType is a
 * free-form string (app_launch, dataset_import_started/completed,
 * extraction_run, scan_run, attachment_quarantined, export_created,
 * materialization_created -- see call sites). subjectRef identifies what
 * the event is about (a dataset id, attachment id, file path -- whatever
 * is meaningful for that eventType). payload is any JSON-serializable
 * object, or null. Returns the inserted record.
 *
 * Synchronous end-to-end (node:sqlite's API is synchronous, no await
 * between reading the last record and inserting the next one) -- this is
 * what makes the sequenceNumber/prevRecordHash chain safe without a
 * transaction: nothing else can interleave a write between the read and
 * the insert.
 */
export function appendEvent(db, { eventType, subjectRef = null, payload = null }) {
  const last = getLastRecord(db);
  const sequenceNumber = (last?.sequenceNumber ?? 0) + 1;
  const timestampUtc = new Date().toISOString();
  const payloadJson = payload != null ? JSON.stringify(payload) : null;
  const prevRecordHash = last?.recordHash ?? null;

  const recordHash = computeRecordHash({ sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash });

  getInsertStatement(db).run({ sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash, recordHash });

  return { sequenceNumber, timestampUtc, eventType, subjectRef, payloadJson, prevRecordHash, recordHash };
}

/**
 * Walks the whole chain in sequence order, recomputing each record's
 * hash from its own stored fields and comparing it to the stored
 * recordHash, and checking each record's prevRecordHash actually points
 * at the prior record's recordHash. Returns { ok: true, checked } or, for
 * the FIRST break found, { ok: false, brokenAtSequence, reason, checked }.
 *
 * This detects a retroactive edit to any field of any row, or a
 * deleted/reordered row. It does not, and cannot on its own, stop
 * someone with direct DB write access from rewriting an entire
 * contiguous suffix of the chain to stay internally consistent --  that
 * limitation is inherent to a hash chain with no external anchor, and is
 * exactly why this is operational record-keeping, not a chain-of-custody
 * guarantee (see the disclaimer at the top of this file).
 */
export function verifyChain(db) {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY sequenceNumber ASC').all();

  let expectedPrev = null;
  for (const row of rows) {
    const recomputed = computeRecordHash({
      sequenceNumber: row.sequenceNumber,
      timestampUtc: row.timestampUtc,
      eventType: row.eventType,
      subjectRef: row.subjectRef,
      payloadJson: row.payloadJson,
      prevRecordHash: row.prevRecordHash,
    });
    if (recomputed !== row.recordHash) {
      return { ok: false, brokenAtSequence: row.sequenceNumber, reason: 'recordHash does not match a recomputed hash of this record', checked: rows.length };
    }
    if (row.prevRecordHash !== expectedPrev) {
      return { ok: false, brokenAtSequence: row.sequenceNumber, reason: "prevRecordHash does not match the prior record's recordHash", checked: rows.length };
    }
    expectedPrev = row.recordHash;
  }

  return { ok: true, checked: rows.length };
}
