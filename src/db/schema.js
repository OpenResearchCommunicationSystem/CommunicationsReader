import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.js';
import { backfillNormalizedHash } from './backfill-normalized-hash.js';
import { backfillTokenIndex } from './backfill-token-index.js';

// SQLite is source-agnostic on purpose: email is the only producer today,
// but SMS/chat-app/UFDR/Penlink parsers are expected later. `datasets` is
// the unit a user selects against (one / multiple / all). `communications`
// models any unit of communication (email, text, chat message, call
// record); columns that only make sense for email are simply left NULL by
// non-email sources, and `sourceSpecific` is a JSON catch-all for fields
// that don't earn a real column. See src/db/insert.js for the dedup policy
// this schema is designed around.
// Table definitions only -- no CREATE INDEX here. Indexes live in
// INDEXES_SQL below and run AFTER runMigrations(), not as part of this
// block -- see the comment on INDEXES_SQL for why that split is load-
// bearing, not stylistic.
const TABLES_SQL = `
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
  threadMethod       TEXT,
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

CREATE TABLE IF NOT EXISTS participants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  identifier        TEXT NOT NULL,
  displayName       TEXT,
  sortOrder         INTEGER NOT NULL DEFAULT 0
);

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

-- Hand-rolled inverted index (node:sqlite has no FTS5, and a WASM/FTS5
-- build was deliberately rejected -- new third-party attack surface on a
-- tool that processes hostile input by design). One row per word token;
-- see src/search/token-index.js for how it's populated and
-- src/search/candidate-narrow.js for how it's queried. attachmentId is
-- only set for fieldKind='attachment_text' -- lets a re-extraction
-- (force: true) cleanly delete and rebuild just that attachment's
-- entries without touching the rest of the communication's index.
CREATE TABLE IF NOT EXISTS token_index (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  attachmentId      INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  fieldKind         TEXT NOT NULL,
  token             TEXT NOT NULL,
  tokenPosition     INTEGER NOT NULL
);

-- One row per source archive ever imported (keyed by the archive's own
-- sha256, the same hash already computed for the S2 audit log), tracking
-- how far a batched-commit insert got. Lets electron/main.js's
-- import-archive handler transparently resume an import interrupted by
-- the laptop losing power/sleeping mid-way (see src/db/insert.js)
-- instead of restarting from message 0 and re-doing potentially hours of
-- work. status='completed' means nothing to resume -- re-importing that
-- same archive again is just a normal (intentional) re-import, same as
-- this app already supports for "the same mailbox exported twice".
CREATE TABLE IF NOT EXISTS import_progress (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  archiveSha256       TEXT NOT NULL UNIQUE,
  datasetId           INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
  lastProcessedIndex  INTEGER NOT NULL DEFAULT -1,
  totalCount          INTEGER,
  status              TEXT NOT NULL DEFAULT 'in_progress',
  updatedAt           INTEGER NOT NULL
);
`;

// Indexes are deliberately kept OUT of TABLES_SQL and run only after
// runMigrations() -- confirmed as a real regression, not a theoretical
// one: on a DB created by a build before S1 (contentHash/quarantineStatus/
// quarantineReason on attachments), CREATE TABLE IF NOT EXISTS is a
// no-op against the already-existing attachments table, so those
// columns don't exist yet at this point -- if the CREATE INDEX for them
// ran here, "no such column: quarantineStatus" would abort the whole
// exec() before runMigrations() ever got a chance to add the column.
// Every index below is safe to (re)create idempotently once its
// column(s) are guaranteed to exist, whether that's because the table
// was just created fresh (TABLES_SQL) or because a migration just added
// the column to a pre-existing table (runMigrations()).
const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_communications_dataset   ON communications(datasetId);
CREATE INDEX IF NOT EXISTS idx_communications_rawhash   ON communications(rawHash);
CREATE INDEX IF NOT EXISTS idx_communications_normhash  ON communications(normalizedHash);
CREATE INDEX IF NOT EXISTS idx_communications_timestamp ON communications(timestamp);
CREATE INDEX IF NOT EXISTS idx_communications_threadid  ON communications(threadId);

CREATE INDEX IF NOT EXISTS idx_participants_communication ON participants(communicationId);
CREATE INDEX IF NOT EXISTS idx_participants_identifier    ON participants(identifier);

CREATE INDEX IF NOT EXISTS idx_attachments_communication    ON attachments(communicationId);
CREATE INDEX IF NOT EXISTS idx_attachments_extractionstatus ON attachments(extractionStatus);
CREATE INDEX IF NOT EXISTS idx_attachments_quarantinestatus ON attachments(quarantineStatus);
CREATE INDEX IF NOT EXISTS idx_attachments_contenthash      ON attachments(contentHash);

CREATE INDEX IF NOT EXISTS idx_crypto_matches_communication ON crypto_matches(communicationId);
CREATE INDEX IF NOT EXISTS idx_crypto_matches_attachment    ON crypto_matches(attachmentId);
CREATE INDEX IF NOT EXISTS idx_crypto_matches_type          ON crypto_matches(matchType);

CREATE INDEX IF NOT EXISTS idx_audit_log_sequence  ON audit_log(sequenceNumber);
CREATE INDEX IF NOT EXISTS idx_audit_log_eventtype ON audit_log(eventType);

CREATE INDEX IF NOT EXISTS idx_focus_set_members_communication ON focus_set_members(communicationId);

CREATE INDEX IF NOT EXISTS idx_token_index_token         ON token_index(token);
CREATE INDEX IF NOT EXISTS idx_token_index_communication  ON token_index(communicationId);
CREATE INDEX IF NOT EXISTS idx_token_index_attachment     ON token_index(attachmentId);

CREATE INDEX IF NOT EXISTS idx_import_progress_archive ON import_progress(archiveSha256);
`;

/**
 * Opens (creating if necessary) a SQLite database at dbPath and ensures the
 * schema exists. Pass ':memory:' for an ephemeral in-memory DB (used by
 * tests). Order matters: tables, then migrations (add any column missing
 * from a pre-existing table), then indexes -- see INDEXES_SQL's comment.
 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(TABLES_SQL);
  runMigrations(db);
  db.exec(INDEXES_SQL);
  backfillNormalizedHash(db);
  backfillTokenIndex(db);
  return db;
}
