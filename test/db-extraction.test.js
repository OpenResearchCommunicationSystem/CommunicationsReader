import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildMinimalDocx } from './fixtures/generate-office-fixtures.js';
import { renderTextToPng } from './fixtures/render-text-png.js';
import { writeBufferToTemp } from './helpers/temp-file.js';

// See test/translate.test.js's header for why this mock boundary exists
// (OCR is AI-API-backed since 2026-11, not a local model). Registered
// BEFORE the dynamic imports below, not as static imports at file top --
// a static import of run-extraction.js/ocr.js would resolve (and lock
// in) the real ai-assist/index.js during ESM hoisting, before this
// mock.module() call ever runs.
let ocrCallCount = 0;
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    ocrImageViaAi: async () => {
      ocrCallCount++;
      return { text: 'HELLO', meta: { ocrEngine: 'ai:mock:test', ocrConfidenceMean: null } };
    },
    translateChunkViaAi: async (text) => ({ text: `[EN] ${text}`, meta: { translationEngine: 'ai:mock:test' } }),
  },
});

const { openDatabase } = await import('../src/db/schema.js');
const { insertDataset } = await import('../src/db/insert.js');
const { runExtraction } = await import('../src/extract/run-extraction.js');
const { terminateOcrWorker } = await import('../src/extract/ocr.js');

function insertBareCommunication(db, datasetId) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', 'x', 'y', ?)`
    )
    .run(datasetId, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, { filename, mimeType, savedPath, contentHash }) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, mimeType, savedPath, contentHash) VALUES (?, ?, ?, ?, ?)`
    )
    .run(communicationId, filename, mimeType, savedPath, contentHash ?? null);
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
  const { filePath: disguisedPath, cleanup: cleanupDisguised } = await writeBufferToTemp(
    buildMinimalDocx('should never be extracted'),
    'fake.pdf'
  );
  const quarantinedAttachmentId = insertAttachment(db, communicationId, {
    filename: 'fake.pdf',
    mimeType: 'application/pdf',
    savedPath: disguisedPath,
  });

  try {
    const summary = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(summary.attempted, 4);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);

    const unsupportedRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(unsupportedAttachmentId);
    assert.equal(unsupportedRow.extractionStatus, 'not_attempted');
    assert.equal(unsupportedRow.extractionMethod, null);
    assert.equal(unsupportedRow.quarantineStatus, 'pending');

    const docxRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(docxAttachmentId);
    assert.equal(docxRow.extractionStatus, 'attempted_succeeded');
    assert.equal(docxRow.extractionMethod, 'docx-mammoth');
    assert.ok(docxRow.extractedText.includes('Extraction pipeline test content'));
    assert.ok(docxRow.extractedAt > 0);
    assert.equal(docxRow.quarantineStatus, 'verified');

    const brokenRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(brokenAttachmentId);
    assert.equal(brokenRow.extractionStatus, 'attempted_failed');
    assert.ok(brokenRow.extractionError);
    assert.equal(brokenRow.quarantineStatus, 'error');

    const quarantinedRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(quarantinedAttachmentId);
    assert.equal(quarantinedRow.extractionStatus, 'not_attempted');
    assert.equal(quarantinedRow.quarantineStatus, 'rejected');
    assert.ok(quarantinedRow.quarantineReason);

    // extraction_run logs a summary event; attachment_quarantined logs
    // the rejected attachment specifically (S2 audit log).
    const events = db.prepare('SELECT * FROM audit_log ORDER BY sequenceNumber ASC').all();
    const runEvent = events.find((e) => e.eventType === 'extraction_run');
    assert.ok(runEvent);
    const runPayload = JSON.parse(runEvent.payloadJson);
    assert.equal(runPayload.attempted, 4);
    assert.equal(runPayload.succeeded, 1);
    assert.equal(runPayload.failed, 1);
    assert.equal(runPayload.quarantined, 1);

    const quarantineEvent = events.find((e) => e.eventType === 'attachment_quarantined');
    assert.ok(quarantineEvent);
    assert.equal(quarantineEvent.subjectRef, String(quarantinedAttachmentId));

    // A second run with no force option should find nothing left to do.
    const secondSummary = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(secondSummary.attempted, 0);

    // force: true re-processes everything EXCEPT the rejected/quarantined
    // attachment, which is never retried even under force.
    const forcedSummary = await runExtraction(db, { datasetIds: [datasetId], force: true });
    assert.equal(forcedSummary.attempted, 3);
  } finally {
    await cleanupDocx();
    await cleanupDisguised();
    db.close();
  }
});

test('runExtraction reuses the result for byte-identical attachments (contentHash + kind match)', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const { filePath: docxPath, cleanup: cleanupDocx } = await writeBufferToTemp(
    buildMinimalDocx('Forwarded contract text'),
    'contract.docx'
  );
  const originalId = insertAttachment(db, communicationId, {
    filename: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: docxPath,
    contentHash: 'same-bytes-hash',
  });
  // Same contentHash + same kind, but savedPath points at a file that
  // doesn't exist -- if dedup actually skips re-extraction (rather than
  // just grouping rows for bookkeeping), this row's own broken savedPath
  // is never read, and it still comes out 'attempted_succeeded'.
  const forwardedId = insertAttachment(db, communicationId, {
    filename: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: '/definitely/missing-duplicate.docx',
    contentHash: 'same-bytes-hash',
  });

  try {
    const summary = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(summary.attempted, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.deduped, 1);

    const originalRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(originalId);
    const forwardedRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(forwardedId);

    assert.equal(forwardedRow.extractionStatus, 'attempted_succeeded');
    assert.equal(forwardedRow.extractedText, originalRow.extractedText);
    assert.ok(forwardedRow.extractedText.includes('Forwarded contract text'));

    const forwardedMeta = JSON.parse(forwardedRow.extractionMeta);
    assert.equal(forwardedMeta.dedupedFromAttachmentId, originalId);
  } finally {
    await cleanupDocx();
    db.close();
  }
});

test('runExtraction never reaches the AI-backed OCR path when includeImages is false (import-time default)', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const communicationId = insertBareCommunication(db, datasetId);

  const { filePath: docxPath, cleanup: cleanupDocx } = await writeBufferToTemp(
    buildMinimalDocx('deterministic extraction still runs'),
    'report.docx'
  );
  const docxAttachmentId = insertAttachment(db, communicationId, {
    filename: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    savedPath: docxPath,
  });
  const { filePath: pngPath, cleanup: cleanupPng } = await writeBufferToTemp(renderTextToPng('HELLO'), 'photo.png');
  const imageAttachmentId = insertAttachment(db, communicationId, {
    filename: 'photo.png',
    mimeType: 'image/png',
    savedPath: pngPath,
  });

  try {
    ocrCallCount = 0;
    // This is the exact call shape electron/main.js's import-archive and
    // import-autopsy-case handlers must use -- see their own comments.
    const summary = await runExtraction(db, { datasetIds: [datasetId], includeImages: false });

    assert.equal(ocrCallCount, 0, 'OCR (the AI-backed path) must never be called when includeImages is false');
    // Only the docx counts as "attempted" -- the image was filtered out
    // up front, not attempted-and-skipped.
    assert.equal(summary.attempted, 1);
    assert.equal(summary.succeeded, 1);

    const docxRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(docxAttachmentId);
    assert.equal(docxRow.extractionStatus, 'attempted_succeeded');

    // Left genuinely untouched (extractedAt IS NULL), not marked
    // not_attempted/failed -- so a later explicit OCR run still picks it
    // up, same as any other never-yet-processed attachment.
    const imageRow = db.prepare('SELECT * FROM attachments WHERE id = ?').get(imageAttachmentId);
    assert.equal(imageRow.extractionStatus, 'not_attempted');
    assert.equal(imageRow.extractedAt, null);

    // The investigator's own explicit, later OCR run (includeImages left
    // at its true default) is the only path that may reach the AI.
    const followUp = await runExtraction(db, { datasetIds: [datasetId] });
    assert.equal(ocrCallCount, 1);
    assert.equal(followUp.attempted, 1);
    const imageRowAfter = db.prepare('SELECT * FROM attachments WHERE id = ?').get(imageAttachmentId);
    assert.equal(imageRowAfter.extractionStatus, 'attempted_succeeded');
    assert.equal(imageRowAfter.extractedText, 'HELLO');
  } finally {
    await cleanupDocx();
    await cleanupPng();
    db.close();
  }
});

after(async () => {
  await terminateOcrWorker();
});
