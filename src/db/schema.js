import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.js';
import { backfillNormalizedHash } from './backfill-normalized-hash.js';

// SQLite is source-agnostic on purpose: email is the only producer today,
// but SMS/chat-app/UFDR/Penlink parsers are expected later. `datasets` is
// the unit a user selects against (one / multiple / all). `communications`
// models any unit of communication (email, text, chat message, call
// record); columns that only make sense for email are simply left NULL by
// non-email sources, and `sourceSpecific` is a JSON catch-all for fields
// that don't earn a real column. See src/db/insert.js for the dedup policy
// this schema is designed around.
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS datasets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceType        TEXT NOT NULL,
  label             TEXT,
  originalPath      TEXT NOT NULL,
  importedAt        INTEGER NOT NULL,
  containerType     TEXT,
  succeededCount    INTEGER NOT NULL DEFAULT 0,
  failedCount       INTEGER NOT NULL DEFAULT 0,
  totalCount        INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  importerVersion   TEXT,
  attachmentsDir    TEXT
);

CREATE TABLE IF NOT EXISTS communications (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  datasetId          INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  sourceType         TEXT NOT NULL,
  commType           TEXT NOT NULL DEFAULT 'message',

  timestamp          INTEGER,
  durationSeconds    INTEGER,

  subject            TEXT,
  bodyText           TEXT,
  bodyHtml           TEXT,
  bodyEmpty          INTEGER NOT NULL DEFAULT 0,

  fromRaw            TEXT,
  toRaw              TEXT,
  ccRaw              TEXT,

  direction          TEXT,

  threadId           TEXT,
  messageId          TEXT,
  inReplyTo          TEXT,
  referencesJson     TEXT,

  rawHash            TEXT NOT NULL,
  normalizedHash     TEXT NOT NULL,

  encodingUncertain  INTEGER NOT NULL DEFAULT 0,
  charsetOverridden  INTEGER NOT NULL DEFAULT 0,

  sourceRef          TEXT,
  sourceSpecific     TEXT,

  createdAt          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_communications_dataset   ON communications(datasetId);
CREATE INDEX IF NOT EXISTS idx_communications_rawhash   ON communications(rawHash);
CREATE INDEX IF NOT EXISTS idx_communications_normhash  ON communications(normalizedHash);
CREATE INDEX IF NOT EXISTS idx_communications_timestamp ON communications(timestamp);
CREATE INDEX IF NOT EXISTS idx_communications_threadid  ON communications(threadId);

CREATE TABLE IF NOT EXISTS participants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  identifier        TEXT NOT NULL,
  displayName       TEXT,
  sortOrder         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_participants_communication ON participants(communicationId);
CREATE INDEX IF NOT EXISTS idx_participants_identifier    ON participants(identifier);

-- extractionStatus is one of: 'not_attempted' (unsupported type, e.g.
-- legacy .doc/video -- also the pre-pipeline default), 'attempted_failed',
-- or 'attempted_succeeded'. extractedText is NULL for the first two and a
-- string (possibly '') for the third -- an empty string distinguishes
-- "succeeded, genuinely no text found" (e.g. a blank scanned page) from
-- "never attempted"/"failed". extractionMeta is a JSON catch-all for
-- format-specific detail (OCR confidence, PDF page counts, etc.) that
-- doesn't earn its own column, mirroring communications.sourceSpecific.
-- NOTE: 'not_attempted' is both the pre-pipeline default AND the
-- terminal state for unsupported types, so "has the pipeline run on this
-- row yet" must be determined from extractedAt IS NULL, never from
-- extractionStatus alone (see src/extract/run-extraction.js).
--
-- quarantineStatus is a SEPARATE lifecycle from extractionStatus: it
-- describes whether the raw bytes were ever verified safe to hand to an
-- extractor, not whether text extraction itself succeeded. One of:
-- 'pending' (default, not yet verified -- also the permanent state for
-- unsupported types, which are never verified since nothing ever
-- extracts them), 'verified' (magic-byte + structural checks passed --
-- an extractor was invoked, regardless of whether extraction itself then
-- succeeded or failed), 'rejected' (claimed-vs-actual content mismatch or
-- a size/complexity limit was exceeded -- extractionStatus stays
-- 'not_attempted' for these, an extractor is never invoked), or 'error'
-- (the verification step itself couldn't run, e.g. the file was
-- unreadable). See src/extract/magic-bytes.js and src/extract/limits.js.
CREATE TABLE IF NOT EXISTS attachments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename          TEXT,
  size              INTEGER,
  mimeType          TEXT,
  savedPath         TEXT,

  contentHash       TEXT,

  extractionStatus  TEXT NOT NULL DEFAULT 'not_attempted',
  extractionMethod  TEXT,
  extractedText     TEXT,
  extractionError   TEXT,
  extractionMeta    TEXT,
  extractedAt       INTEGER,

  quarantineStatus  TEXT NOT NULL DEFAULT 'pending',
  quarantineReason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_communication    ON attachments(communicationId);
CREATE INDEX IF NOT EXISTS idx_attachments_extractionstatus ON attachments(extractionStatus);
CREATE INDEX IF NOT EXISTS idx_attachments_quarantinestatus ON attachments(quarantineStatus);
CREATE INDEX IF NOT EXISTS idx_attachments_contenthash      ON attachments(contentHash);

-- One row per detected wallet-address or keyword hit. Exactly one of
-- communicationId/attachmentId is set per row (a match either came from a
-- communication's bodyText directly, or from an attachment's
-- extractedText). Derived/recomputable data, not raw imported evidence --
-- unlike communications, rows here CAN be deleted and re-inserted when a
-- rescan is requested (see src/crypto-detect/scan.js).
CREATE TABLE IF NOT EXISTS crypto_matches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER REFERENCES communications(id) ON DELETE CASCADE,
  attachmentId      INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  sourceField       TEXT NOT NULL,
  matchType         TEXT NOT NULL,
  matchedText       TEXT NOT NULL,
  patternName       TEXT NOT NULL,
  offset            INTEGER,
  context           TEXT,
  createdAt         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crypto_matches_communication ON crypto_matches(communicationId);
CREATE INDEX IF NOT EXISTS idx_crypto_matches_attachment    ON crypto_matches(attachmentId);
CREATE INDEX IF NOT EXISTS idx_crypto_matches_type          ON crypto_matches(matchType);

-- Append-only, hash-chained operational record of ingest/processing/
-- export events (app_launch, dataset_import_started/completed,
-- extraction_run, scan_run, attachment_quarantined, export_created,
-- materialization_created). See src/audit/audit-log.js for the full
-- disclaimer this table implies: it is operational record-keeping for
-- malware containment, case compartmentalization, and the analyst's own
-- reference -- it is NOT a chain-of-custody or evidentiary system.
-- sequenceNumber is monotonic; recordHash covers this row's own fields
-- PLUS prevRecordHash, so a retroactive edit to any earlier row is
-- detectable from that point forward via verifyChain().
CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sequenceNumber  INTEGER NOT NULL UNIQUE,
  timestampUtc    TEXT NOT NULL,
  eventType       TEXT NOT NULL,
  subjectRef      TEXT,
  payloadJson     TEXT,
  prevRecordHash  TEXT,
  recordHash      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_sequence  ON audit_log(sequenceNumber);
CREATE INDEX IF NOT EXISTS idx_audit_log_eventtype ON audit_log(eventType);

-- Generic key/value store for one-time app-level markers (e.g. "has this
-- DB already had a particular one-time data backfill applied") that
-- don't warrant their own dedicated table. See
-- src/db/backfill-normalized-hash.js for the first consumer.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- An iteratively-built working set of communications the investigator has
-- deliberately pulled out to focus on -- built up across multiple
-- searches/techniques, one message or one whole thread at a time (see
-- src/db/focus-set.js). Not scoped to a single dataset -- a focus set can
-- legitimately span datasets, same as cross-dataset dedup already does.
-- UNIQUE on communicationId makes adding an already-present member
-- (e.g. individually, then again via "add whole thread") a safe no-op.
CREATE TABLE IF NOT EXISTS focus_set_members (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  addedVia          TEXT NOT NULL,
  addedAt           INTEGER NOT NULL,
  sourceNote        TEXT,
  UNIQUE(communicationId)
);

CREATE INDEX IF NOT EXISTS idx_focus_set_members_communication ON focus_set_members(communicationId);
`;

/**
 * Opens (creating if necessary) a SQLite database at dbPath and ensures the
 * schema exists. Pass ':memory:' for an ephemeral in-memory DB (used by
 * tests).
 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  backfillNormalizedHash(db);
  return db;
}
