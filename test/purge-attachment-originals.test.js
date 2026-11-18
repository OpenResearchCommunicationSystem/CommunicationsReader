import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { purgeAttachmentOriginals } from '../src/db/purge-attachment-originals.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

function insertBareCommunication(db, datasetId) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', 'x', 'y', ?)`
    )
    .run(datasetId, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, { filename, savedPath, extractedText = null, mimeType = 'application/octet-stream' }) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, mimeType, savedPath, extractedText, extractionStatus)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(communicationId, filename, mimeType, savedPath, extractedText, extractedText ? 'attempted_succeeded' : 'not_attempted');
  return Number(res.lastInsertRowid);
}

test('purgeAttachmentOriginals deletes the file, nulls savedPath, and keeps extractedText', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const { filePath, cleanup } = await writeBufferToTemp(Buffer.from('fake docx bytes'), 'report.docx');
  const attachmentId = insertAttachment(db, communicationId, {
    filename: 'report.docx',
    savedPath: filePath,
    extractedText: 'already extracted content',
  });

  try {
    assert.ok(existsSync(filePath), 'sanity check: file exists before purge');

    const result = await purgeAttachmentOriginals(db, [datasetId]);
    assert.deepEqual(result, { purged: 1, rerendered: 0 });
    assert.equal(existsSync(filePath), false, 'the original file must be gone from disk');

    const row = db.prepare('SELECT savedPath, extractedText FROM attachments WHERE id = ?').get(attachmentId);
    assert.equal(row.savedPath, null);
    assert.equal(row.extractedText, 'already extracted content', 'extracted text must survive the purge');

    const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'attachment_originals_purged'`).get();
    assert.ok(event);
    assert.deepEqual(JSON.parse(event.payloadJson), { datasetIds: [datasetId], purged: 1, rerendered: 0 });
  } finally {
    await cleanup(); // rm(..., { force: true }) already tolerates the file being gone
    db.close();
  }
});

test('purgeAttachmentOriginals is a safe no-op when every savedPath is already null (e.g. an Autopsy-sourced dataset)', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'autopsy-case', originalPath: 'case/' });
  const communicationId = insertBareCommunication(db, datasetId);
  insertAttachment(db, communicationId, { filename: 'stub.txt', savedPath: null });

  const result = await purgeAttachmentOriginals(db, [datasetId]);
  assert.deepEqual(result, { purged: 0, rerendered: 0 });
  db.close();
});

test('purgeAttachmentOriginals tolerates a savedPath whose file is already missing on disk', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);
  const attachmentId = insertAttachment(db, communicationId, {
    filename: 'already-gone.docx',
    savedPath: '/definitely/does/not/exist-anywhere.docx',
  });

  const result = await purgeAttachmentOriginals(db, [datasetId]);
  assert.equal(result.purged, 1, 'still counted and cleared, even though there was nothing to unlink');

  const row = db.prepare('SELECT savedPath FROM attachments WHERE id = ?').get(attachmentId);
  assert.equal(row.savedPath, null);
  db.close();
});

test('purgeAttachmentOriginals only touches the requested dataset(s)', async () => {
  const db = openDatabase(':memory:');
  const datasetA = insertDataset(db, { sourceType: 'email-eml', originalPath: 'a.zip' });
  const datasetB = insertDataset(db, { sourceType: 'email-eml', originalPath: 'b.zip' });
  const commA = insertBareCommunication(db, datasetA);
  const commB = insertBareCommunication(db, datasetB);

  const { filePath: pathA, cleanup: cleanupA } = await writeBufferToTemp(Buffer.from('a'), 'a.docx');
  const { filePath: pathB, cleanup: cleanupB } = await writeBufferToTemp(Buffer.from('b'), 'b.docx');
  const attA = insertAttachment(db, commA, { filename: 'a.docx', savedPath: pathA });
  const attB = insertAttachment(db, commB, { filename: 'b.docx', savedPath: pathB });

  try {
    const result = await purgeAttachmentOriginals(db, [datasetA]);
    assert.equal(result.purged, 1);

    assert.equal(db.prepare('SELECT savedPath FROM attachments WHERE id = ?').get(attA).savedPath, null);
    assert.equal(db.prepare('SELECT savedPath FROM attachments WHERE id = ?').get(attB).savedPath, pathB);
    assert.ok(existsSync(pathB), "dataset B's file must be untouched");
  } finally {
    await cleanupA();
    await cleanupB();
    db.close();
  }
});

test('purgeAttachmentOriginals replaces an image with a safe re-rendered JPEG instead of deleting it', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const originalJpeg = jpeg.encode({ width: 2, height: 2, data: new Uint8Array(2 * 2 * 4).fill(200) }, 90).data;
  const { filePath, cleanup } = await writeBufferToTemp(originalJpeg, 'photo.jpg');
  const attachmentId = insertAttachment(db, communicationId, {
    filename: 'photo.jpg',
    savedPath: filePath,
    mimeType: 'image/jpeg',
  });

  try {
    const result = await purgeAttachmentOriginals(db, [datasetId]);
    assert.deepEqual(result, { purged: 0, rerendered: 1 });

    const row = db.prepare('SELECT savedPath, mimeType, size FROM attachments WHERE id = ?').get(attachmentId);
    assert.ok(row.savedPath, 'a file is still kept for an image -- unlike every other format');
    assert.notEqual(row.savedPath, filePath, 'replaced by a new, distinct file');
    assert.equal(existsSync(filePath), false, 'the original file is gone');
    assert.equal(existsSync(row.savedPath), true, 'the safe replacement exists');
    assert.equal(row.mimeType, 'image/jpeg');

    // The kept file must actually be a valid, re-decodable JPEG -- not
    // just any bytes sitting at that path.
    const kept = readFileSync(row.savedPath);
    const decoded = jpeg.decode(kept, { useTArray: true });
    assert.equal(decoded.width, 2);
    assert.equal(decoded.height, 2);

    const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'attachment_originals_purged'`).get();
    assert.deepEqual(JSON.parse(event.payloadJson), { datasetIds: [datasetId], purged: 0, rerendered: 1 });
  } finally {
    await cleanup();
    db.close();
  }
});

test('purgeAttachmentOriginals falls back to deleting an image that fails to safely re-render (e.g. WebP, or corrupt bytes)', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const { filePath, cleanup } = await writeBufferToTemp(Buffer.from('RIFF....WEBPVP8 not a real decodable webp'), 'photo.webp');
  const attachmentId = insertAttachment(db, communicationId, {
    filename: 'photo.webp',
    savedPath: filePath,
    mimeType: 'image/webp',
  });

  try {
    const result = await purgeAttachmentOriginals(db, [datasetId]);
    assert.deepEqual(result, { purged: 1, rerendered: 0 });

    const row = db.prepare('SELECT savedPath FROM attachments WHERE id = ?').get(attachmentId);
    assert.equal(row.savedPath, null, 'no safe render exists for WebP, so it falls back to the normal zero-bytes purge');
    assert.equal(existsSync(filePath), false);
  } finally {
    await cleanup();
    db.close();
  }
});
