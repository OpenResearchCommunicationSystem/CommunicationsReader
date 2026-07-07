import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { runExtraction } from '../src/extract/run-extraction.js';
import { terminateOcrWorker } from '../src/extract/ocr.js';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
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

function insertAttachment(db, communicationId, { filename, mimeType, savedPath }) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, mimeType, savedPath) VALUES (?, ?, ?, ?)`
    )
    .run(communicationId, filename, mimeType, savedPath);
  return Number(res.lastInsertRowid);
}

test('runExtraction processes not_attempted attachments and writes results back', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const { filePath: docxPath, cleanup: cleanupDocx } = await writeBufferToTemp(
    buildMinimalDocx('Extraction pipeline test content'),
    'attachment.docx'
  );
  const unsupportedAttachmentId = insertAttachment(db, communicationId, {
    filename: 'video.mp4',
    mimeType: 'video/mp4',
    savedPath: '/does/not/matter.mp4',
  });
  const docxAttachmentId = insertAttachment(db, communicationId, {
    filename: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: docxPath,
  });
  const brokenAttachmentId = insertAttachment(db, communicationId, {
    filename: 'broken.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: '/definitely/missing.docx',
  });

  try {
    const summary = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(summary.attempted, 3);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);

    const unsupportedRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(unsupportedAttachmentId);
    assert.equal(unsupportedRow.extractionStatus, 'not_attempted');
    assert.equal(unsupportedRow.extractionMethod, null);

    const docxRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(docxAttachmentId);
    assert.equal(docxRow.extractionStatus, 'attempted_succeeded');
    assert.equal(docxRow.extractionMethod, 'docx-mammoth');
    assert.ok(docxRow.extractedText.includes('Extraction pipeline test content'));
    assert.ok(docxRow.extractedAt > 0);

    const brokenRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(brokenAttachmentId);
    assert.equal(brokenRow.extractionStatus, 'attempted_failed');
    assert.ok(brokenRow.extractionError);

    // A second run with no force option should find nothing left to do.
    const secondSummary = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(secondSummary.attempted, 0);

    // force: true re-processes everything, including already-succeeded rows.
    const forcedSummary = await runExtraction(db, { datasetIds: [datasetId], force: true });
    assert.equal(forcedSummary.attempted, 3);
  } finally {
    await cleanupDocx();
    db.close();
  }
});

after(async () => {
  await terminateOcrWorker();
});
