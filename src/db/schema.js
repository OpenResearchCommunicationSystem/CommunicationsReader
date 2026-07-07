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

CREATE TABLE IF NOT EXISTS attachments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  communicationId   INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename          TEXT,
  size              INTEGER,
  mimeType          TEXT,
  savedPath         TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_communication ON attachments(communicationId);
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
