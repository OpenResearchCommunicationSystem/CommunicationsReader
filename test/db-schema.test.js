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
  ]) {
    assert.ok(indexes.includes(idx), `expected index ${idx} to exist`);
  }

  db.close();
});

test('foreign_keys pragma is enabled', () => {
  const db = openDatabase(':memory:');
  const result = db.prepare('PRAGMA foreign_keys').get();
  assert.equal(result.foreign_keys, 1);
  db.close();
});
