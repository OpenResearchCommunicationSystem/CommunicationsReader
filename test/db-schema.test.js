import { test } from 'node:test';
import assert from 'node:assert/strict';
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
