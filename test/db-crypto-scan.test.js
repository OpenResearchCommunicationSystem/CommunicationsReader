import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { runScan } from '../src/crypto-detect/run-scan.js';
import { getCryptoMatches } from '../src/db/query.js';

function insertCommunication(db, datasetId, bodyText) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, bodyText, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?)`
    )
    .run(datasetId, bodyText, `raw-${bodyText.length}-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  return Number(res.lastInsertRowid);
}

function insertExtractedAttachment(db, communicationId, extractedText) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, extractionStatus, extractedText, extractedAt)
       VALUES (?, 'doc.docx', 'attempted_succeeded', ?, ?)`
    )
    .run(communicationId, extractedText, Date.now());
  return Number(res.lastInsertRowid);
}

test('runScan finds wallet/keyword matches in both communication bodies and extracted attachment text', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });

  const commId = insertCommunication(
    db,
    datasetId,
    'Please send the tether payment to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa as discussed.'
  );
  insertExtractedAttachment(db, commId, 'Hawala transfer confirmed: حواله ارسال شد.');

  const summary = runScan(db, { datasetIds: [datasetId] });
  assert.equal(summary.scannedCount, 2); // 1 communication + 1 extracted attachment
  assert.ok(summary.matchCount >= 3); // tether keyword + btc address + hawala keyword

  const matches = getCryptoMatches(db, { datasetIds: [datasetId] });
  const bodyMatches = matches.filter((m) => m.sourceField === 'bodyText');
  const attachmentMatches = matches.filter((m) => m.sourceField === 'extractedText');
  assert.ok(bodyMatches.some((m) => m.matchType === 'btc_legacy'));
  assert.ok(bodyMatches.some((m) => m.patternName === 'keyword_en_tether'));
  assert.ok(attachmentMatches.some((m) => m.patternName === 'keyword_fa_hawala'));

  const scanEvent = db.prepare(`SELECT * FROM audit_log WHERE eventType = 'scan_run' ORDER BY sequenceNumber DESC LIMIT 1`).get();
  assert.ok(scanEvent);
  const scanPayload = JSON.parse(scanEvent.payloadJson);
  assert.equal(scanPayload.scannedCount, summary.scannedCount);
  assert.equal(scanPayload.matchCount, summary.matchCount);

  db.close();
});

test('runScan is safely re-runnable: no duplicate matches after a second scan', () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, 'wallet address bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');

  runScan(db, { datasetIds: [datasetId] });
  const firstCount = getCryptoMatches(db, { datasetIds: [datasetId] }).length;

  runScan(db, { datasetIds: [datasetId] });
  const secondCount = getCryptoMatches(db, { datasetIds: [datasetId] }).length;

  assert.equal(firstCount, secondCount);
  assert.ok(firstCount > 0);

  db.close();
});
