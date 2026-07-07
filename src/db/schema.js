import { DatabaseSync } from 'node:sqlite';

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
  importerVersion   TEXT
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
CREATE TABLE IF NOT EXISTS attachments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename          TEXT,
  size              INTEGER,
  mimeType          TEXT,
  savedPath         TEXT,

  extractionStatus  TEXT NOT NULL DEFAULT 'not_attempted',
  extractionMethod  TEXT,
  extractedText     TEXT,
  extractionError   TEXT,
  extractionMeta    TEXT,
  extractedAt       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_attachments_communication    ON attachments(communicationId);
CREATE INDEX IF NOT EXISTS idx_attachments_extractionstatus ON attachments(extractionStatus);

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
`;

/**
 * Opens (creating if necessary) a SQLite database at dbPath and ensures the
 * schema exists. Pass ':memory:' for an ephemeral in-memory DB (used by
 * tests).
 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}
