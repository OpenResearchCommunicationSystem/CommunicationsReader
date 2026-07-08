import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { getThreadsForDatasets } from '../src/db/thread-query.js';
import { persistThreads } from '../src/threading/persist-threads.js';

function insertCommunication(db, datasetId, { subject = null, bodyText = null, timestamp = null, messageId = null, inReplyTo = null } = {}) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, timestamp, messageId, inReplyTo, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(datasetId, subject, bodyText, timestamp, messageId, inReplyTo, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  return Number(res.lastInsertRowid);
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => a.threadId.localeCompare(b.threadId));
}

test('persistThreads writes threadId and threadMethod back onto every member row', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { subject: 'Hello', messageId: '<a@example.com>', timestamp: 1 });
  const id2 = insertCommunication(db, datasetId, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 2 });

  const summary = persistThreads(db);
  assert.equal(summary.communicationCount, 2);
  assert.equal(summary.threadCount, 1);

  const row1 = db.prepare('SELECT threadId, threadMethod FROM communications WHERE id = ?').get(id1);
  const row2 = db.prepare('SELECT threadId, threadMethod FROM communications WHERE id = ?').get(id2);
  assert.ok(row1.threadId);
  assert.equal(row1.threadId, row2.threadId);
  assert.equal(row1.threadMethod, 'header');

  db.close();
});

test('getThreadsForDatasets falls back to on-demand rebuild when no threadId has been persisted yet', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { subject: 'Hello', messageId: '<a@example.com>', timestamp: 1 });
  insertCommunication(db, datasetId, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 2 });

  const threads = getThreadsForDatasets(db, [datasetId]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].method, 'header');
  assert.equal(threads[0].messageCount, 2);

  db.close();
});

test('getThreadsForDatasets fast path (persisted) produces identical output to the on-demand rebuild', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { subject: 'Hello', messageId: '<a@example.com>', timestamp: 1 });
  insertCommunication(db, datasetId, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 2 });
  insertCommunication(db, datasetId, { subject: 'Unrelated', timestamp: 3 });
  insertCommunication(db, datasetId, { subject: 'Re: Unrelated', timestamp: 4 }); // subject-fallback, no header link, no shared participants -- stays singleton

  const beforePersist = sortThreads(getThreadsForDatasets(db, [datasetId]));
  persistThreads(db);
  const afterPersist = sortThreads(getThreadsForDatasets(db, [datasetId]));

  assert.deepEqual(afterPersist, beforePersist);

  db.close();
});

test('getThreadsForDatasets falls back to rebuild when new unpersisted data is mixed in', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { subject: 'Hello', messageId: '<a@example.com>', timestamp: 1 });
  insertCommunication(db, datasetId, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 2 });
  persistThreads(db);

  // A new message arrives after persistThreads() already ran -- it
  // starts with threadId = NULL (src/db/map-email.js), same as any real
  // freshly-inserted communication.
  insertCommunication(db, datasetId, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 3 });

  const threads = getThreadsForDatasets(db, [datasetId]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].messageCount, 3, 'the new unpersisted message must still show up via the rebuild fallback');

  db.close();
});

test('persistThreads recomputes across the whole DB by default, linking messages across datasets', () => {
  const db = openDatabase(':memory:');
  const datasetA = insertDataset(db, { sourceType: 'email-eml', originalPath: 'a.zip' });
  const datasetB = insertDataset(db, { sourceType: 'email-eml', originalPath: 'b.zip' });
  insertCommunication(db, datasetA, { subject: 'Hello', messageId: '<a@example.com>', timestamp: 1 });
  insertCommunication(db, datasetB, { subject: 'Re: Hello', inReplyTo: '<a@example.com>', timestamp: 2 });

  persistThreads(db);

  const threads = getThreadsForDatasets(db, [datasetA, datasetB]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].messageCount, 2);

  db.close();
});
