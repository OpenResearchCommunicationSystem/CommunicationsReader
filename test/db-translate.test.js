import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';

// See test/translate.test.js's header -- same AI-API mock boundary,
// needed here too since translate-record.js calls through translate.js.
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    translateChunkViaAi: async (text) => ({ text: `[EN] ${text}`, meta: { translationEngine: 'ai:mock:test' } }),
  },
});

const { translateCommunication, translateAttachment } = await import('../src/translate/translate-record.js');

function insertCommunication(db, datasetId, bodyText) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, bodyText, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, 'x', 'y', ?)`
    )
    .run(datasetId, bodyText, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, extractedText) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, extractionStatus, extractedText)
       VALUES (?, 'note.txt', 'attempted_succeeded', ?)`
    )
    .run(communicationId, extractedText);
  return Number(res.lastInsertRowid);
}

test('translateCommunication writes translated columns and logs an audit event', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertCommunication(db, datasetId, 'مرحبا، كيف حالك اليوم؟');

  try {
    const result = await translateCommunication(db, communicationId, 'ara');
    assert.ok(result.text.length > 0);

    const row = db.prepare('SELECT * FROM communications WHERE id = ?').get(communicationId);
    assert.equal(row.translatedText, result.text);
    assert.equal(row.translatedLang, 'ara');
    assert.ok(row.translatedAt > 0);
    assert.equal(JSON.parse(row.translationMeta).sourceLang, 'ara');

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'translation_run' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.ok(event);
    assert.equal(event.subjectRef, String(communicationId));
    const payload = JSON.parse(event.payloadJson);
    assert.equal(payload.target, 'communication');
    assert.equal(payload.communicationId, communicationId);
    assert.equal(payload.sourceLang, 'ara');
  } finally {
    db.close();
  }
});

test('translateAttachment writes translated columns onto the attachment row, not the communication', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertCommunication(db, datasetId, null);
  const attachmentId = insertAttachment(db, communicationId, 'سلام، حال شما چطور است؟');

  try {
    const result = await translateAttachment(db, attachmentId, 'fas');
    assert.ok(result.text.length > 0);

    const attachmentRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
    assert.equal(attachmentRow.translatedText, result.text);
    assert.equal(attachmentRow.translatedLang, 'fas');
    assert.ok(attachmentRow.translatedAt > 0);

    const communicationRow = db.prepare('SELECT * FROM communications WHERE id = ?').get(communicationId);
    assert.equal(communicationRow.translatedText, null);

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'translation_run' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.equal(event.subjectRef, String(attachmentId));
    assert.equal(JSON.parse(event.payloadJson).target, 'attachment');
  } finally {
    db.close();
  }
});

test('translateCommunication throws for a nonexistent communication id', async () => {
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(() => translateCommunication(db, 999999, 'ara'), /no communication with id/);
  } finally {
    db.close();
  }
});
