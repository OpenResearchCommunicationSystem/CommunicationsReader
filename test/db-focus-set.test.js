import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { addToFocusSet, removeFromFocusSet, clearFocusSet, listFocusSet, getFocusSetCount } from '../src/db/focus-set.js';

function insertBareCommunication(db, datasetId, subject) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?)`
    )
    .run(datasetId, subject, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  return Number(res.lastInsertRowid);
}

function setup() {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertBareCommunication(db, datasetId, 'First');
  const id2 = insertBareCommunication(db, datasetId, 'Second');
  const id3 = insertBareCommunication(db, datasetId, 'Third');
  return { db, id1, id2, id3 };
}

test('addToFocusSet adds new members and returns the count actually added', () => {
  const { db, id1, id2 } = setup();
  const added = addToFocusSet(db, [id1, id2], { addedVia: 'manual' });
  assert.equal(added, 2);
  assert.equal(getFocusSetCount(db), 2);
  db.close();
});

test('addToFocusSet is idempotent -- re-adding an existing member changes nothing', () => {
  const { db, id1, id2 } = setup();
  addToFocusSet(db, [id1], { addedVia: 'manual' });
  const secondAdd = addToFocusSet(db, [id1, id2], { addedVia: 'thread_expand', sourceNote: 'thread X' });
  assert.equal(secondAdd, 1); // only id2 is actually new
  assert.equal(getFocusSetCount(db), 2);
  db.close();
});

test('removeFromFocusSet removes members and returns the count actually removed', () => {
  const { db, id1, id2, id3 } = setup();
  addToFocusSet(db, [id1, id2, id3]);
  const removed = removeFromFocusSet(db, [id1, id2, 999999]);
  assert.equal(removed, 2);
  assert.equal(getFocusSetCount(db), 1);
  db.close();
});

test('clearFocusSet empties the whole set', () => {
  const { db, id1, id2, id3 } = setup();
  addToFocusSet(db, [id1, id2, id3]);
  const cleared = clearFocusSet(db);
  assert.equal(cleared, 3);
  assert.equal(getFocusSetCount(db), 0);
  db.close();
});

test('listFocusSet returns full communication rows in the order they were added', () => {
  const { db, id1, id2, id3 } = setup();
  addToFocusSet(db, [id3]);
  addToFocusSet(db, [id1]);
  addToFocusSet(db, [id2]);

  const list = listFocusSet(db);
  assert.deepEqual(list.map((c) => c.id), [id3, id1, id2]);
  assert.equal(list[0].subject, 'Third');
  db.close();
});

test('listFocusSet on an empty set returns an empty array', () => {
  const { db } = setup();
  assert.deepEqual(listFocusSet(db), []);
  db.close();
});
