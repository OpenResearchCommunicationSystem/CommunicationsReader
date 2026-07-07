import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { importArchive } from '../src/parser/index.js';
import { getDedupGroups } from '../src/db/query.js';
import {
  buildKitchenSinkZip,
  buildEmlTreeZip,
  buildDedupPair,
} from './fixtures/generate-fixtures.js';
import { writeZipToTemp } from './helpers/temp-zip.js';

test('single-dataset insert: all messages inserted, rawHash duplicate pair flagged via query not skipped', async () => {
  const { zipPath, cleanup } = await writeZipToTemp(buildKitchenSinkZip(), 'kitchen-sink.zip');
  try {
    const importResult = await importArchive({ zipPath, outputAttachmentsDir: null });
    const db = openDatabase(':memory:');
    const { datasetId, insertedCount, insertFailures } = insertImportResult(db, importResult, {
      sourceType: 'email-eml',
      originalPath: zipPath,
    });

    assert.equal(insertedCount, importResult.summary.succeeded);
    assert.equal(insertFailures.length, 0);

    const rowCount = db.prepare('SELECT COUNT(*) AS c FROM communications WHERE datasetId = ?').get(datasetId).c;
    assert.equal(rowCount, importResult.summary.succeeded, 'no row should be silently skipped for being a duplicate');

    const rawDupGroups = getDedupGroups(db, { datasetIds: [datasetId], by: 'rawHash' });
    assert.equal(rawDupGroups.length, 1, 'the known byte-identical duplicate pair should form exactly one rawHash group');
    assert.equal(rawDupGroups[0].count, 2);

    db.close();
  } finally {
    await cleanup();
  }
});

test('cross-dataset dedup: same content imported via two datasets is never merged, but groups by normalizedHash', async () => {
  const dedup = buildDedupPair();

  const { zipPath: zipPathA, cleanup: cleanupA } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'forward-a.eml', content: dedup.sameContentA }]),
    'dataset-a.zip'
  );
  const { zipPath: zipPathB, cleanup: cleanupB } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'forward-b.eml', content: dedup.sameContentB }]),
    'dataset-b.zip'
  );

  try {
    const importA = await importArchive({ zipPath: zipPathA, outputAttachmentsDir: null });
    const importB = await importArchive({ zipPath: zipPathB, outputAttachmentsDir: null });

    const db = openDatabase(':memory:');
    const resultA = insertImportResult(db, importA, { sourceType: 'email-eml', originalPath: zipPathA, label: 'dataset A' });
    const resultB = insertImportResult(db, importB, { sourceType: 'email-eml', originalPath: zipPathB, label: 'dataset B' });

    assert.notEqual(resultA.datasetId, resultB.datasetId);

    const rowA = db.prepare('SELECT * FROM communications WHERE datasetId = ?').get(resultA.datasetId);
    const rowB = db.prepare('SELECT * FROM communications WHERE datasetId = ?').get(resultB.datasetId);

    assert.notEqual(rowA.rawHash, rowB.rawHash, 'raw bytes differ (different headers/whitespace)');
    assert.equal(rowA.normalizedHash, rowB.normalizedHash, 'normalized content is identical across the two datasets');

    // Nothing merged or skipped: both rows exist independently.
    const totalRows = db.prepare('SELECT COUNT(*) AS c FROM communications').get().c;
    assert.equal(totalRows, 2);

    const groups = getDedupGroups(db, { by: 'normalizedHash' });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    const memberDatasetIds = groups[0].members.map((m) => m.datasetId).sort();
    assert.deepEqual(memberDatasetIds, [resultA.datasetId, resultB.datasetId].sort());

    db.close();
  } finally {
    await cleanupA();
    await cleanupB();
  }
});

test('generic schema fits email cleanly: sourceSpecific is NULL, fields map 1:1', async () => {
  const { zipPath, cleanup } = await writeZipToTemp(buildKitchenSinkZip(), 'kitchen-sink.zip');
  try {
    const importResult = await importArchive({ zipPath, outputAttachmentsDir: null });
    const db = openDatabase(':memory:');
    const { datasetId } = insertImportResult(db, importResult, { sourceType: 'email-eml', originalPath: zipPath });

    const rows = db.prepare('SELECT * FROM communications WHERE datasetId = ?').all(datasetId);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.sourceSpecific, null, 'email leaves no leftover fields needing the JSON catch-all');
      assert.equal(row.sourceType, 'email');
      assert.equal(row.commType, 'message');
    }

    const farsiRow = rows.find((r) => r.subject === 'Farsi UTF-8 happy path');
    assert.ok(farsiRow);
    assert.equal(typeof farsiRow.rawHash, 'string');
    assert.equal(typeof farsiRow.normalizedHash, 'string');

    db.close();
  } finally {
    await cleanup();
  }
});

test('defensive insert: a message missing rawHash is caught and recorded, batch continues', async () => {
  const db = openDatabase(':memory:');
  const datasetId = 1; // not actually pre-created; only used to exercise the catch path below

  const fakeImportResult = {
    containerType: 'eml',
    note: undefined,
    summary: { succeeded: 2, failed: 0, total: 2 },
    messages: [
      {
        from: 'a@example.com',
        to: 'b@example.com',
        cc: null,
        fromList: [],
        toList: [],
        ccList: [],
        subject: 'Good message',
        date: Date.now(),
        messageId: '<good@example.com>',
        inReplyTo: null,
        references: [],
        bodyText: 'fine',
        bodyHtml: null,
        bodyEmpty: false,
        attachments: [],
        rawHash: 'abc123',
        normalizedHash: 'def456',
        encodingUncertain: false,
        charsetOverridden: false,
        sourceInfo: { type: 'eml', path: 'good.eml' },
      },
      {
        // Missing rawHash/normalizedHash -- violates the NOT NULL columns,
        // simulating an impossible/malformed message object.
        from: 'c@example.com',
        to: 'd@example.com',
        cc: null,
        fromList: [],
        toList: [],
        ccList: [],
        subject: 'Broken message',
        date: Date.now(),
        messageId: null,
        inReplyTo: null,
        references: [],
        bodyText: 'broken',
        bodyHtml: null,
        bodyEmpty: false,
        attachments: [],
        rawHash: undefined,
        normalizedHash: undefined,
        encodingUncertain: false,
        charsetOverridden: false,
        sourceInfo: { type: 'eml', path: 'broken.eml' },
      },
    ],
  };

  const { insertedCount, insertFailures } = insertImportResult(db, fakeImportResult, {
    sourceType: 'email-eml',
    originalPath: 'fake.zip',
  });

  assert.equal(insertedCount, 1);
  assert.equal(insertFailures.length, 1);
  assert.equal(insertFailures[0].sourceInfo.path, 'broken.eml');
  assert.ok(insertFailures[0].error);

  const rows = db.prepare('SELECT * FROM communications').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, 'Good message');

  db.close();
});

// Hypothetical non-email fitness (illustrative only -- no SMS/UFDR parser
// exists yet). Shows the generic schema accepts a call-detail-record-shaped
// row with zero schema changes: commType 'call', no subject/bodyHtml,
// durationSeconds populated, phone numbers as fromRaw/toRaw, and anything
// source-specific (e.g. carrier metadata) tucked into sourceSpecific JSON
// rather than requiring new columns.
test('hypothetical: a non-email (call record) row would fit the schema with no migration', () => {
  const db = openDatabase(':memory:');
  const datasetId = db
    .prepare(
      `INSERT INTO datasets (sourceType, originalPath, importedAt, succeededCount, failedCount, totalCount)
       VALUES ('penlink-cdr', 'fake-cdr.csv', ?, 1, 0, 1)`
    )
    .run(Date.now()).lastInsertRowid;

  const res = db
    .prepare(
      `INSERT INTO communications (
         datasetId, sourceType, commType, timestamp, durationSeconds,
         bodyText, bodyEmpty, fromRaw, toRaw, direction,
         rawHash, normalizedHash, sourceSpecific, createdAt
       ) VALUES (
         @datasetId, 'penlink-cdr', 'call', @timestamp, 42,
         NULL, 1, '+15551234567', '+15559876543', 'outbound',
         'fake-raw-hash', 'fake-normalized-hash', @sourceSpecific, @createdAt
       )`
    )
    .run({
      datasetId,
      timestamp: Date.now(),
      sourceSpecific: JSON.stringify({ carrier: 'unknown', towerId: 'XYZ-123' }),
      createdAt: Date.now(),
    });

  assert.ok(res.lastInsertRowid);
  const row = db.prepare('SELECT * FROM communications WHERE id = ?').get(res.lastInsertRowid);
  assert.equal(row.commType, 'call');
  assert.equal(row.subject, null);
  assert.equal(row.durationSeconds, 42);
  assert.equal(JSON.parse(row.sourceSpecific).towerId, 'XYZ-123');

  db.close();
});
