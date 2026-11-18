import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// Same AI-API mock boundary as test/db-extraction.test.js -- registered
// before the dynamic imports below so it's in place before ESM hoisting
// resolves the real ai-assist/index.js.
let ocrCallCount = 0;
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    ocrImageViaAi: async () => {
      ocrCallCount++;
      return { text: 'HELLO', meta: { ocrEngine: 'ai:mock:test', ocrConfidenceMean: null } };
    },
  },
});

const { openDatabase } = await import('../src/db/schema.js');
const { insertDataset } = await import('../src/db/insert.js');
const { imageToText } = await import('../src/extract/attachment-image-to-text.js');

function insertBareCommunication(db, datasetId) {
  const res = db
    .prepare(`INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt) VALUES (?, 'email', 'x', 'y', ?)`)
    .run(datasetId, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, { filename, mimeType, savedPath }) {
  const res = db
    .prepare(`INSERT INTO attachments (communicationId, filename, mimeType, savedPath) VALUES (?, ?, ?, ?)`)
    .run(communicationId, filename, mimeType, savedPath);
  return Number(res.lastInsertRowid);
}

test('imageToText OCRs exactly one attachment, writes the result back, and logs an audit event -- no dataset-wide pass involved', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);
  const { filePath: pngPath, cleanup } = await writeBufferToTemp(renderTextToPng('HELLO'), 'specimen-id-petrenko.png');
  const attachmentId = insertAttachment(db, communicationId, { filename: 'specimen-id-petrenko.png', mimeType: 'image/png', savedPath: pngPath });

  try {
    ocrCallCount = 0;
    const result = await imageToText(db, attachmentId);
    assert.equal(result.status, 'attempted_succeeded');
    assert.equal(result.text, 'HELLO');
    assert.equal(ocrCallCount, 1);

    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
    assert.equal(row.extractionStatus, 'attempted_succeeded');
    assert.equal(row.extractedText, 'HELLO');
    assert.equal(row.extractionMethod, 'image-ocr');

    const event = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'image_to_text_run' ORDER BY sequenceNumber DESC LIMIT 1`).get();
    assert.ok(event);
    assert.equal(event.subjectRef, String(attachmentId));
    assert.equal(JSON.parse(event.payloadJson).status, 'attempted_succeeded');
  } finally {
    await cleanup();
    db.close();
  }
});

test('imageToText can be re-run on demand, overwriting a prior result -- the replacement for the removed bulk "Re-run OCR" button', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);
  const { filePath: pngPath, cleanup } = await writeBufferToTemp(renderTextToPng('HELLO'), 'photo.jpg');
  const attachmentId = insertAttachment(db, communicationId, { filename: 'photo.jpg', mimeType: 'image/jpeg', savedPath: pngPath });

  try {
    ocrCallCount = 0;
    await imageToText(db, attachmentId);
    await imageToText(db, attachmentId);
    assert.equal(ocrCallCount, 2, 'an explicit re-run must always reach the AI endpoint again, unlike run-extraction.js\'s force-skip-if-already-done default');
  } finally {
    await cleanup();
    db.close();
  }
});

test('imageToText throws for an attachment that is not image-kind at all -- this action never touches docx/xlsx/pdf', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);
  const { filePath: docxPath, cleanup } = await writeBufferToTemp(buildMinimalDocx('not an image'), 'report.docx');
  const attachmentId = insertAttachment(db, communicationId, {
    filename: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: docxPath,
  });

  try {
    await assert.rejects(() => imageToText(db, attachmentId), /is not an image/);
  } finally {
    await cleanup();
    db.close();
  }
});

test('imageToText throws for a nonexistent attachment id', async () => {
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(() => imageToText(db, 999999), /no attachment with id/);
  } finally {
    db.close();
  }
});
