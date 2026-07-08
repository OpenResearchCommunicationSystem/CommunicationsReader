import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { backfillTokenIndex } from '../src/db/backfill-token-index.js';

function insertRawCommunication(db, { subject, bodyText }) {
  const datasetId = db
    .prepare(`INSERT INTO datasets (sourceType, originalPath, importedAt) VALUES ('email-eml', 'x.zip', 0)`)
    .run().lastInsertRowid;
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?)`
    )
    .run(datasetId, subject, bodyText, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  return Number(res.lastInsertRowid);
}

function insertRawAttachment(db, communicationId, extractedText, status = 'attempted_succeeded') {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, extractionStatus, extractedText, extractedAt)
       VALUES (?, 'doc.docx', ?, ?, ?)`
    )
    .run(communicationId, status, extractedText, Date.now());
  return Number(res.lastInsertRowid);
}

test('backfillTokenIndex indexes every existing communication and successfully-extracted attachment', () => {
  const db = openDatabase(':memory:');
  const commId = insertRawCommunication(db, { subject: 'Wire transfer', bodyText: 'please send the wallet address' });
  insertRawAttachment(db, commId, 'Certificate No: SGS-IR-2021-04521');
  db.prepare(`DELETE FROM app_meta WHERE key = 'tokenIndexBackfillApplied'`).run();

  const result = backfillTokenIndex(db);
  assert.equal(result.ran, true);
  assert.equal(result.indexedCommunications, 1);
  assert.equal(result.indexedAttachments, 1);

  const hasWallet = db.prepare(`SELECT 1 FROM token_index WHERE token = 'wallet' AND communicationId = ?`).get(commId);
  assert.ok(hasWallet);
  const hasCertificate = db.prepare(`SELECT 1 FROM token_index WHERE token = 'certificate'`).get();
  assert.ok(hasCertificate);

  db.close();
});

test('backfillTokenIndex never indexes a not-yet-extracted or failed attachment', () => {
  const db = openDatabase(':memory:');
  const commId = insertRawCommunication(db, { subject: 's', bodyText: 'b' });
  insertRawAttachment(db, commId, null, 'not_attempted');
  insertRawAttachment(db, commId, null, 'attempted_failed');
  db.prepare(`DELETE FROM app_meta WHERE key = 'tokenIndexBackfillApplied'`).run();

  const result = backfillTokenIndex(db);
  assert.equal(result.indexedAttachments, 0);

  db.close();
});

test('backfillTokenIndex is idempotent -- a second call is a no-op once the marker is set', () => {
  const db = openDatabase(':memory:');
  insertRawCommunication(db, { subject: 's', bodyText: 'b' });
  db.prepare(`DELETE FROM app_meta WHERE key = 'tokenIndexBackfillApplied'`).run();

  const first = backfillTokenIndex(db);
  assert.equal(first.ran, true);
  const second = backfillTokenIndex(db);
  assert.deepEqual(second, { ran: false, indexedCommunications: 0, indexedAttachments: 0 });

  db.close();
});

test('a pre-existing communication becomes searchable again after backfillTokenIndex runs', async () => {
  const { runSearch } = await import('../src/search/run-search.js');
  const db = openDatabase(':memory:');
  insertRawCommunication(db, { subject: 'Old data', bodyText: 'a message from before token_index existed' });
  db.prepare(`DELETE FROM app_meta WHERE key = 'tokenIndexBackfillApplied'`).run();

  // Before backfill: candidate-narrowing sees zero index entries for this
  // row, so it would be wrongly excluded. No datasetIds scoping -- the
  // point here is the missing-index gap, not dataset filtering.
  const beforeResult = runSearch(db, { query: 'existed' });
  assert.equal(beforeResult.resultCount, 0);

  backfillTokenIndex(db);

  const afterResult = runSearch(db, { query: 'existed' });
  assert.equal(afterResult.resultCount, 1);

  db.close();
});
