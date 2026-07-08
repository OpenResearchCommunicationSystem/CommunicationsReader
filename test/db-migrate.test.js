import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';

function buildPreMigrationAttachmentsTable(db) {
  db.exec(`
    CREATE TABLE attachments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      communicationId   INTEGER NOT NULL,
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
    )
  `);
}

test('runMigrations adds missing attachments columns to a pre-migration DB without losing existing rows', () => {
  const db = new DatabaseSync(':memory:');
  buildPreMigrationAttachmentsTable(db);
  db.exec(`INSERT INTO attachments (communicationId, filename) VALUES (1, 'old-row.bin')`);

  runMigrations(db);

  const columns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  assert.ok(columns.includes('contentHash'));
  assert.ok(columns.includes('quarantineStatus'));
  assert.ok(columns.includes('quarantineReason'));

  const row = db.prepare(`SELECT * FROM attachments WHERE filename = 'old-row.bin'`).get();
  assert.equal(row.contentHash, null);
  assert.equal(row.quarantineStatus, 'pending');
  assert.equal(row.quarantineReason, null);

  db.close();
});

test('runMigrations is idempotent -- safe to call twice on the same DB', () => {
  const db = new DatabaseSync(':memory:');
  buildPreMigrationAttachmentsTable(db);

  assert.doesNotThrow(() => {
    runMigrations(db);
    runMigrations(db);
  });

  const columns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  assert.ok(columns.includes('contentHash'));

  db.close();
});

test('runMigrations is a no-op on a DB whose table already has the columns (fresh schema.js CREATE TABLE)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE attachments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      communicationId   INTEGER NOT NULL,
      contentHash       TEXT,
      quarantineStatus  TEXT NOT NULL DEFAULT 'pending',
      quarantineReason  TEXT
    )
  `);
  assert.doesNotThrow(() => runMigrations(db));
  db.close();
});
