import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';

function fakeMessage(i) {
  return {
    from: `sender${i}@example.com`,
    to: 'recipient@example.com',
    cc: null,
    fromList: [],
    toList: [],
    ccList: [],
    subject: `Message ${i}`,
    date: Date.now(),
    messageId: `<msg-${i}@example.com>`,
    inReplyTo: null,
    references: [],
    bodyText: `Body of message ${i}`,
    bodyHtml: null,
    bodyEmpty: false,
    attachments: [],
    rawHash: `raw-${i}`,
    normalizedHash: `norm-${i}`,
    encodingUncertain: false,
    charsetOverridden: false,
    sourceInfo: { type: 'eml', path: `msg-${i}.eml` },
  };
}

function fakeImportResult(count) {
  const messages = Array.from({ length: count }, (_, i) => fakeMessage(i));
  return {
    containerType: 'eml',
    note: undefined,
    summary: { succeeded: count, failed: 0, total: count },
    messages,
  };
}

test('insertImportResult tracks import_progress and marks it completed on a fresh import', () => {
  const db = openDatabase(':memory:');
  const archiveSha256 = 'archive-hash-fresh';
  const result = insertImportResult(db, fakeImportResult(4), {
    sourceType: 'email-eml',
    originalPath: 'x.zip',
    archiveSha256,
  });

  assert.equal(result.insertedCount, 4);
  const progress = db.prepare('SELECT * FROM import_progress WHERE archiveSha256 = ?').get(archiveSha256);
  assert.equal(progress.status, 'completed');
  assert.equal(progress.datasetId, result.datasetId);
  assert.equal(progress.lastProcessedIndex, 3);

  db.close();
});

test('insertImportResult without archiveSha256 behaves exactly as before -- no progress tracking, still fully inserts', () => {
  const db = openDatabase(':memory:');
  const result = insertImportResult(db, fakeImportResult(5), { sourceType: 'email-eml', originalPath: 'x.zip' });
  assert.equal(result.insertedCount, 5);
  const progressCount = db.prepare('SELECT COUNT(*) AS c FROM import_progress').get().c;
  assert.equal(progressCount, 0);
  db.close();
});

test('re-importing an archive whose import_progress is already completed creates a new dataset (intentional re-import), not a resume', () => {
  const db = openDatabase(':memory:');
  const archiveSha256 = 'archive-hash-completed';
  const fullResult = fakeImportResult(3);

  const first = insertImportResult(db, fullResult, { sourceType: 'email-eml', originalPath: 'x.zip', archiveSha256 });
  const second = insertImportResult(db, fullResult, { sourceType: 'email-eml', originalPath: 'x.zip', archiveSha256 });

  assert.notEqual(first.datasetId, second.datasetId);
  assert.equal(second.insertedCount, 3);
  const totalCommunications = db.prepare('SELECT COUNT(*) AS c FROM communications').get().c;
  assert.equal(totalCommunications, 6); // both imports' rows coexist, same as any other re-import

  db.close();
});

test('insertImportResult resumes an interrupted (in_progress) import from the last committed index, without duplicating already-committed rows', () => {
  const db = openDatabase(':memory:');
  const archiveSha256 = 'archive-hash-interrupted';
  const fullResult = fakeImportResult(6);

  // Simulate "the process died after committing messages 0-2, before
  // ever reaching message 3" -- can't literally interrupt a synchronous
  // call mid-loop from a test, so this crafts the equivalent on-disk
  // state directly: the first half actually inserted (via a real,
  // ordinary insertImportResult call, no progress tracking involved),
  // plus a hand-written import_progress row recording "only got to
  // index 2" against that same dataset.
  const partialResult = fakeImportResult(6);
  partialResult.messages = partialResult.messages.slice(0, 3);
  const partial = insertImportResult(db, partialResult, { sourceType: 'email-eml', originalPath: 'x.zip' });

  db.prepare(
    `INSERT INTO import_progress (archiveSha256, datasetId, lastProcessedIndex, totalCount, status, updatedAt)
     VALUES (?, ?, 2, 6, 'in_progress', ?)`
  ).run(archiveSha256, partial.datasetId, Date.now());

  // Now "resume": re-parse (fakeImportResult(6) again, same content) and
  // call insertImportResult with the matching archiveSha256.
  const resumed = insertImportResult(db, fullResult, { sourceType: 'email-eml', originalPath: 'x.zip', archiveSha256 });

  assert.equal(resumed.datasetId, partial.datasetId, 'resume must reuse the same dataset, not create a new one');
  assert.equal(resumed.insertedCount, 6, '3 already-committed + 3 newly-inserted');

  const totalForDataset = db.prepare('SELECT COUNT(*) AS c FROM communications WHERE datasetId = ?').get(partial.datasetId).c;
  assert.equal(totalForDataset, 6, 'no duplicates -- messages 0-2 were never re-inserted');

  // Every message's subject should appear exactly once.
  for (let i = 0; i < 6; i++) {
    const rows = db.prepare('SELECT COUNT(*) AS c FROM communications WHERE subject = ?').get(`Message ${i}`);
    assert.equal(rows.c, 1, `message ${i} should exist exactly once`);
  }

  const progress = db.prepare('SELECT * FROM import_progress WHERE archiveSha256 = ?').get(archiveSha256);
  assert.equal(progress.status, 'completed');
  assert.equal(progress.lastProcessedIndex, 5);

  db.close();
});

test('a resumed import still indexes the newly-inserted messages for search', () => {
  const db = openDatabase(':memory:');
  const archiveSha256 = 'archive-hash-resume-index';
  const fullResult = fakeImportResult(4);

  const partialResult = fakeImportResult(4);
  partialResult.messages = partialResult.messages.slice(0, 2);
  const partial = insertImportResult(db, partialResult, { sourceType: 'email-eml', originalPath: 'x.zip' });

  db.prepare(
    `INSERT INTO import_progress (archiveSha256, datasetId, lastProcessedIndex, totalCount, status, updatedAt)
     VALUES (?, ?, 1, 4, 'in_progress', ?)`
  ).run(archiveSha256, partial.datasetId, Date.now());

  insertImportResult(db, fullResult, { sourceType: 'email-eml', originalPath: 'x.zip', archiveSha256 });

  const indexedTokens = db.prepare(`SELECT DISTINCT token FROM token_index WHERE token LIKE '%message%'`).all();
  assert.ok(indexedTokens.length > 0);
  // Message 3's body ("Body of message 3") should be indexed even though
  // it was only inserted on the resumed call.
  const hasMessage3 = db.prepare(`SELECT 1 FROM token_index WHERE token = '3'`).get();
  assert.ok(hasMessage3);

  db.close();
});
