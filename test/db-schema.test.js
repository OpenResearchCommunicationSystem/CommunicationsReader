import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/schema.js';

test('schema creates all expected tables and indexes', () => {
  const db = openDatabase(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes('datasets'));
  assert.ok(tables.includes('communications'));
  assert.ok(tables.includes('participants'));
  assert.ok(tables.includes('attachments'));
  assert.ok(tables.includes('crypto_matches'));
  assert.ok(tables.includes('audit_log'));
  assert.ok(tables.includes('app_meta'));

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all()
    .map((r) => r.name);

  for (const idx of [
    'idx_communications_dataset',
    'idx_communications_rawhash',
    'idx_communications_normhash',
    'idx_communications_timestamp',
    'idx_communications_threadid',
    'idx_participants_communication',
    'idx_participants_identifier',
    'idx_attachments_communication',
    'idx_attachments_extractionstatus',
    'idx_attachments_quarantinestatus',
    'idx_attachments_contenthash',
    'idx_crypto_matches_communication',
    'idx_crypto_matches_attachment',
    'idx_crypto_matches_type',
    'idx_audit_log_sequence',
    'idx_audit_log_eventtype',
  ]) {
    assert.ok(indexes.includes(idx), `expected index ${idx} to exist`);
  }

  db.close();
});

test('attachments table has the extraction-result columns with correct defaults', () => {
  const db = openDatabase(':memory:');
  const columns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  for (const col of ['extractionStatus', 'extractionMethod', 'extractedText', 'extractionError', 'extractionMeta', 'extractedAt']) {
    assert.ok(columns.includes(col), `expected attachments.${col} to exist`);
  }

  db.exec(`INSERT INTO datasets (sourceType, originalPath, importedAt) VALUES ('email-eml', 'x.zip', 0)`);
  db.exec(`INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt) VALUES (1, 'email', 'a', 'b', 0)`);
  db.exec(`INSERT INTO attachments (communicationId, filename) VALUES (1, 'test.bin')`);
  const row = db.prepare('SELECT * FROM attachments WHERE id = 1').get();
  assert.equal(row.extractionStatus, 'not_attempted');
  assert.equal(row.extractedText, null);
  assert.equal(row.extractedAt, null);

  db.close();
});

test('attachments table has the quarantine-lifecycle and contentHash columns with correct defaults', () => {
  const db = openDatabase(':memory:');
  const columns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  for (const col of ['contentHash', 'quarantineStatus', 'quarantineReason']) {
    assert.ok(columns.includes(col), `expected attachments.${col} to exist`);
  }

  db.exec(`INSERT INTO datasets (sourceType, originalPath, importedAt) VALUES ('email-eml', 'x.zip', 0)`);
  db.exec(`INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt) VALUES (1, 'email', 'a', 'b', 0)`);
  db.exec(`INSERT INTO attachments (communicationId, filename) VALUES (1, 'test.bin')`);
  const row = db.prepare('SELECT * FROM attachments WHERE id = 1').get();
  assert.equal(row.contentHash, null);
  assert.equal(row.quarantineStatus, 'pending');
  assert.equal(row.quarantineReason, null);

  db.close();
});

test('foreign_keys pragma is enabled', () => {
  const db = openDatabase(':memory:');
  const result = db.prepare('PRAGMA foreign_keys').get();
  assert.equal(result.foreign_keys, 1);
  db.close();
});

// Regression test for a real crash: openDatabase() used to run every
// CREATE INDEX (including ones on brand-new columns like
// attachments.quarantineStatus) in the same exec() call as CREATE TABLE
// IF NOT EXISTS, before runMigrations() ever ran. On a genuinely
// pre-existing on-disk DB (attachments table already exists from an
// older build, without the new columns), that CREATE INDEX threw "no
// such column", aborting startup before the migration that would have
// added the column ever got a chance to run. A fresh :memory: DB never
// exercises this path, since CREATE TABLE includes the new columns from
// scratch -- confirmed directly against a copy of a real pre-S1
// on-disk database before this test was written. Must use a real file,
// not :memory:, and must build the OLD table shape with a separate
// DatabaseSync first, then hand that file to the real openDatabase().
test('openDatabase does not crash opening a pre-existing on-disk DB missing newer attachments columns', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'schema-regression-'));
  const dbPath = path.join(dir, 'old-shape.db');
  try {
    // Full pre-S1 column set for datasets/communications (unchanged since
    // Milestone 1-3, so any real old DB has all of these) -- only
    // attachments is missing columns, since contentHash/quarantineStatus/
    // quarantineReason were the S1 additions that triggered this bug.
    const oldDb = new DatabaseSync(dbPath);
    oldDb.exec(`
      CREATE TABLE datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sourceType TEXT NOT NULL, label TEXT, originalPath TEXT NOT NULL,
        importedAt INTEGER NOT NULL, containerType TEXT, succeededCount INTEGER NOT NULL DEFAULT 0,
        failedCount INTEGER NOT NULL DEFAULT 0, totalCount INTEGER NOT NULL DEFAULT 0, note TEXT,
        importerVersion TEXT, attachmentsDir TEXT
      );
      CREATE TABLE communications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, datasetId INTEGER NOT NULL, sourceType TEXT NOT NULL,
        commType TEXT NOT NULL DEFAULT 'message', timestamp INTEGER, durationSeconds INTEGER, subject TEXT,
        bodyText TEXT, bodyHtml TEXT, bodyEmpty INTEGER NOT NULL DEFAULT 0, fromRaw TEXT, toRaw TEXT, ccRaw TEXT,
        direction TEXT, threadId TEXT, messageId TEXT, inReplyTo TEXT, referencesJson TEXT,
        rawHash TEXT NOT NULL, normalizedHash TEXT NOT NULL, encodingUncertain INTEGER NOT NULL DEFAULT 0,
        charsetOverridden INTEGER NOT NULL DEFAULT 0, sourceRef TEXT, sourceSpecific TEXT, createdAt INTEGER NOT NULL
      );
      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, communicationId INTEGER NOT NULL, filename TEXT, size INTEGER,
        mimeType TEXT, savedPath TEXT, extractionStatus TEXT NOT NULL DEFAULT 'not_attempted',
        extractionMethod TEXT, extractedText TEXT, extractionError TEXT, extractionMeta TEXT, extractedAt INTEGER
      );
      INSERT INTO datasets (sourceType, originalPath, importedAt) VALUES ('email-eml', 'old.zip', 0);
      INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt) VALUES (1, 'email', 'a', 'b', 0);
      INSERT INTO attachments (communicationId, filename) VALUES (1, 'old-attachment.bin');
    `);
    oldDb.close();

    const db = openDatabase(dbPath);
    const columns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
    assert.ok(columns.includes('contentHash'));
    assert.ok(columns.includes('quarantineStatus'));
    assert.ok(columns.includes('quarantineReason'));

    const row = db.prepare(`SELECT * FROM attachments WHERE filename = 'old-attachment.bin'`).get();
    assert.equal(row.quarantineStatus, 'pending'); // ALTER TABLE ... DEFAULT applies to pre-existing rows too

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    assert.ok(indexes.includes('idx_attachments_quarantinestatus'));
    assert.ok(indexes.includes('idx_attachments_contenthash'));

    db.close();
  } finally {
    // Windows can briefly hold the WAL-mode db file handle open just
    // after close() -- retry the directory removal rather than flake.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
