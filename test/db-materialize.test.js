import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { addToFocusSet } from '../src/db/focus-set.js';
import { materializeFocusSet } from '../src/db/materialize.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

function insertCommunication(db, datasetId, subject) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?)`
    )
    .run(datasetId, subject, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, { filename, savedPath, contentHash }) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, savedPath, contentHash, extractionStatus)
       VALUES (?, ?, ?, ?, 'attempted_succeeded')`
    )
    .run(communicationId, filename, savedPath, contentHash);
  return Number(res.lastInsertRowid);
}

test('materializeFocusSet dedupes attachments sharing a contentHash and preserves every reference', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip', label: 'source' });

  const commA = insertCommunication(db, datasetId, 'Message A');
  const commB = insertCommunication(db, datasetId, 'Message B');
  const commC = insertCommunication(db, datasetId, 'Message C');

  const { filePath: memePath, cleanup: cleanupMeme } = await writeBufferToTemp(Buffer.from('the same meme image bytes'), 'meme.jpg');
  const { filePath: uniquePath, cleanup: cleanupUnique } = await writeBufferToTemp(Buffer.from('a one-off document'), 'report.docx');
  const { filePath: legacyPath, cleanup: cleanupLegacy } = await writeBufferToTemp(Buffer.from('pre-S1 attachment, no hash'), 'legacy.bin');

  // The same file, forwarded 3 times across 3 different messages -- all
  // share the identical contentHash a real content-hash computation
  // would produce.
  const sharedHash = 'shared-meme-hash-abc123';
  insertAttachment(db, commA, { filename: 'meme.jpg', savedPath: memePath, contentHash: sharedHash });
  insertAttachment(db, commB, { filename: 'meme.jpg', savedPath: memePath, contentHash: sharedHash });
  insertAttachment(db, commC, { filename: 'meme-copy.jpg', savedPath: memePath, contentHash: sharedHash });
  // A one-off, unique attachment.
  insertAttachment(db, commA, { filename: 'report.docx', savedPath: uniquePath, contentHash: 'unique-hash-xyz' });
  // No contentHash at all (simulates a row from before S1) -- must never
  // be deduped against anything, even another null-hash row.
  insertAttachment(db, commB, { filename: 'legacy.bin', savedPath: legacyPath, contentHash: null });

  addToFocusSet(db, [commA, commB, commC], { addedVia: 'manual' });

  const outputDir = await mkdtemp(path.join(tmpdir(), 'materialize-test-'));
  try {
    const summary = materializeFocusSet(db, outputDir);

    assert.equal(summary.communicationCount, 3);
    assert.equal(summary.datasetCount, 1);
    assert.equal(summary.totalAttachmentReferences, 5);
    assert.equal(summary.uniqueFiles, 3, 'shared meme (x3) + unique doc + legacy = 3 unique files on disk');
    assert.equal(summary.duplicatesSaved, 2);

    const filesOnDisk = await readdir(path.join(outputDir, 'attachments'));
    assert.equal(filesOnDisk.length, 3);

    const outDb = openDatabase(path.join(outputDir, 'focus-set.db'));
    try {
      const outComms = outDb.prepare('SELECT * FROM communications').all();
      assert.equal(outComms.length, 3);

      const outAttachments = outDb.prepare('SELECT * FROM attachments').all();
      assert.equal(outAttachments.length, 5);

      const memeRows = outAttachments.filter((a) => a.contentHash === sharedHash);
      assert.equal(memeRows.length, 3);
      const distinctMemePaths = new Set(memeRows.map((a) => a.savedPath));
      assert.equal(distinctMemePaths.size, 1, 'all 3 meme references should point at the same copied file');

      const legacyRow = outAttachments.find((a) => a.filename === 'legacy.bin');
      assert.ok(legacyRow.savedPath);
      assert.notEqual(legacyRow.savedPath, [...distinctMemePaths][0]);

      const outDataset = outDb.prepare('SELECT * FROM datasets').get();
      assert.ok(outDataset.label.includes('source'));
    } finally {
      outDb.close();
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await cleanupMeme();
    await cleanupUnique();
    await cleanupLegacy();
    db.close();
  }
});

test('materializeFocusSet logs a materialization_created audit event on the source db', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const commA = insertCommunication(db, datasetId, 'Message A');
  addToFocusSet(db, [commA]);

  const outputDir = await mkdtemp(path.join(tmpdir(), 'materialize-test-'));
  try {
    const summary = materializeFocusSet(db, outputDir);
    const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'materialization_created'`).get();
    assert.ok(event);
    const payload = JSON.parse(event.payloadJson);
    assert.equal(payload.communicationCount, summary.communicationCount);
    assert.equal(event.subjectRef, outputDir);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    db.close();
  }
});

test('materializeFocusSet throws when the focus set is empty', async () => {
  const db = openDatabase(':memory:');
  const outputDir = await mkdtemp(path.join(tmpdir(), 'materialize-test-'));
  try {
    assert.throws(() => materializeFocusSet(db, outputDir), /empty/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    db.close();
  }
});
