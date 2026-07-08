import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { backfillNormalizedHash } from '../src/db/backfill-normalized-hash.js';
import { normalizeBody } from '../src/parser/body-normalize.js';
import { computeNormalizedHash } from '../src/parser/hash.js';

function insertRawCommunication(db, { subject, fromRaw, bodyText, normalizedHash }) {
  const datasetId = db
    .prepare(`INSERT INTO datasets (sourceType, originalPath, importedAt) VALUES ('email-eml', 'x.zip', 0)`)
    .run().lastInsertRowid;
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, fromRaw, bodyText, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?)`
    )
    .run(datasetId, subject, fromRaw, bodyText, `raw-${Math.random()}`, normalizedHash, Date.now());
  return Number(res.lastInsertRowid);
}

test('backfillNormalizedHash recomputes every row with the corrected algorithm', () => {
  const db = openDatabase(':memory:');
  // openDatabase() already ran the backfill once against an empty DB (its
  // marker is set) -- insert rows with an obviously-wrong placeholder
  // normalizedHash to prove a second, explicit call still corrects them.
  const id1 = insertRawCommunication(db, {
    subject: 'Hello',
    fromRaw: 'alice@example.com',
    bodyText: 'body one',
    normalizedHash: 'placeholder-wrong-hash-1',
  });
  const id2 = insertRawCommunication(db, {
    subject: 'World',
    fromRaw: 'bob@example.com',
    bodyText: 'body two',
    normalizedHash: 'placeholder-wrong-hash-2',
  });

  // Force a re-run by clearing the marker this test's own openDatabase()
  // call already set.
  db.prepare(`DELETE FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).run();

  const result = backfillNormalizedHash(db);
  assert.equal(result.ran, true);
  assert.equal(result.updated, 2);

  const row1 = db.prepare('SELECT normalizedHash FROM communications WHERE id = ?').get(id1);
  const row2 = db.prepare('SELECT normalizedHash FROM communications WHERE id = ?').get(id2);
  assert.equal(row1.normalizedHash, computeNormalizedHash(normalizeBody('body one'), { subject: 'Hello', from: 'alice@example.com' }));
  assert.equal(row2.normalizedHash, computeNormalizedHash(normalizeBody('body two'), { subject: 'World', from: 'bob@example.com' }));

  db.close();
});

test('backfillNormalizedHash is idempotent -- a second call is a no-op once the marker is set', () => {
  const db = openDatabase(':memory:');
  insertRawCommunication(db, { subject: 's', fromRaw: 'f', bodyText: 'b', normalizedHash: 'wrong' });
  db.prepare(`DELETE FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).run();

  const first = backfillNormalizedHash(db);
  assert.equal(first.ran, true);
  assert.equal(first.updated, 1);

  const second = backfillNormalizedHash(db);
  assert.deepEqual(second, { ran: false, updated: 0 });

  db.close();
});

test('backfillNormalizedHash preserves cross-dataset dedup grouping: two rows with identical content, different envelope, converge on the same corrected hash', () => {
  const db = openDatabase(':memory:');
  const id1 = insertRawCommunication(db, {
    subject: 'Forwarded thread',
    fromRaw: 'Alice <alice@example.com>',
    bodyText: 'This is the forwarded content.\nSecond line of content.',
    normalizedHash: 'stale-a',
  });
  const id2 = insertRawCommunication(db, {
    subject: 'Forwarded thread',
    fromRaw: 'Alice <alice@example.com>',
    bodyText: 'This is the forwarded content.  \nSecond line of content.\n\n',
    normalizedHash: 'stale-b',
  });
  db.prepare(`DELETE FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).run();

  backfillNormalizedHash(db);

  const row1 = db.prepare('SELECT normalizedHash FROM communications WHERE id = ?').get(id1);
  const row2 = db.prepare('SELECT normalizedHash FROM communications WHERE id = ?').get(id2);
  assert.equal(row1.normalizedHash, row2.normalizedHash);

  db.close();
});

test('backfillNormalizedHash on an empty DB sets the marker but logs no audit event (no-op run)', () => {
  const db = openDatabase(':memory:');
  db.prepare(`DELETE FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).run();

  const result = backfillNormalizedHash(db);
  assert.equal(result.ran, true);
  assert.equal(result.updated, 0);

  const marker = db.prepare(`SELECT value FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).get();
  assert.ok(marker);

  const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'normalized_hash_backfill'`).get();
  assert.equal(event, undefined);

  db.close();
});

test('backfillNormalizedHash logs a normalized_hash_backfill audit event when it actually changes rows', () => {
  const db = openDatabase(':memory:');
  insertRawCommunication(db, { subject: 's', fromRaw: 'f', bodyText: 'b', normalizedHash: 'wrong' });
  db.prepare(`DELETE FROM app_meta WHERE key = 'normalizedHashSeparatorFixApplied'`).run();

  backfillNormalizedHash(db);

  const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'normalized_hash_backfill'`).get();
  assert.ok(event);
  assert.equal(JSON.parse(event.payloadJson).updated, 1);

  db.close();
});
