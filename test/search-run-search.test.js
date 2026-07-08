import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { runSearch } from '../src/search/run-search.js';
import { indexCommunicationText, indexAttachmentText } from '../src/search/token-index.js';

// Indexes alongside the raw insert, same as src/db/insert.js does for a
// real import -- runSearch's candidate-narrowing only sees a row at all
// if it's in token_index, so a fixture that skipped this would silently
// make its own rows unsearchable rather than testing anything real.
function insertCommunication(db, datasetId, { subject = null, bodyText = null, fromRaw = null, toRaw = null } = {}) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, fromRaw, toRaw, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(datasetId, subject, bodyText, fromRaw, toRaw, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  const id = Number(res.lastInsertRowid);
  indexCommunicationText(db, { id, subject, bodyText, fromRaw, toRaw });
  return id;
}

function insertExtractedAttachment(db, communicationId, extractedText) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, extractionStatus, extractedText, extractedAt)
       VALUES (?, 'doc.docx', 'attempted_succeeded', ?, ?)`
    )
    .run(communicationId, extractedText, Date.now());
  indexAttachmentText(db, communicationId, Number(res.lastInsertRowid), extractedText);
}

test('runSearch finds a matching communication within a dataset', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { subject: 'invoice', bodyText: 'please send the wallet transfer' });

  const result = runSearch(db, { datasetIds: [datasetId], query: 'wallet' });
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].hits[0].field, 'body');

  db.close();
});

test('runSearch respects dataset scoping', () => {
  const db = openDatabase(':memory:');
  const datasetA = insertDataset(db, { sourceType: 'email-eml', originalPath: 'a.zip' });
  const datasetB = insertDataset(db, { sourceType: 'email-eml', originalPath: 'b.zip' });
  insertCommunication(db, datasetA, { bodyText: 'wallet transfer in dataset A' });
  insertCommunication(db, datasetB, { bodyText: 'wallet transfer in dataset B' });

  const result = runSearch(db, { datasetIds: [datasetA], query: 'wallet' });
  assert.equal(result.resultCount, 1);

  db.close();
});

test('runSearch finds matches inside attachment extractedText', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const commId = insertCommunication(db, datasetId, { bodyText: 'see attached certificate' });
  insertExtractedAttachment(db, commId, 'Certificate No: SGS-IR-2021-04521');

  const result = runSearch(db, { datasetIds: [datasetId], query: 'SGS-IR-2021-04521' });
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].hits[0].field, 'attachment');

  db.close();
});

test('runSearch on an empty/whitespace query returns no results without erroring', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { bodyText: 'anything at all' });

  const result = runSearch(db, { datasetIds: [datasetId], query: '   ' });
  assert.equal(result.resultCount, 0);
  assert.equal(result.error, undefined);

  db.close();
});

test('runSearch on a malformed query returns an error instead of throwing', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { bodyText: 'anything at all' });

  const result = runSearch(db, { datasetIds: [datasetId], query: '/unterminated' });
  assert.equal(result.resultCount, 0);
  assert.ok(result.error);

  db.close();
});

test('runSearch limit stops after the requested number of results', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { bodyText: 'wallet one' });
  insertCommunication(db, datasetId, { bodyText: 'wallet two' });
  insertCommunication(db, datasetId, { bodyText: 'wallet three' });

  const result = runSearch(db, { datasetIds: [datasetId], query: 'wallet', limit: 2 });
  assert.equal(result.resultCount, 2);

  db.close();
});
