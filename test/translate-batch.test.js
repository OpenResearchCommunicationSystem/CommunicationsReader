import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';

// Same AI-API mock boundary as test/db-translate.test.js -- registered
// before the dynamic import below since translate-batch.js calls through
// translate-record.js -> translate.js -> ai-assist/index.js.
let callCount = 0;
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    translateChunkViaAi: async (text) => {
      callCount++;
      return { text: `[EN] ${text}`, meta: { translationEngine: 'ai:mock:test' } };
    },
  },
});

const { translateFocusSelection, previewFocusSelection } = await import('../src/translate/translate-batch.js');

function insertCommunication(db, datasetId, bodyText) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, bodyText, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, 'x', 'y', ?)`
    )
    .run(datasetId, bodyText, Date.now());
  return Number(res.lastInsertRowid);
}

function insertAttachment(db, communicationId, extractedText, contentHash = null) {
  const res = db
    .prepare(
      `INSERT INTO attachments (communicationId, filename, extractionStatus, extractedText, contentHash)
       VALUES (?, 'note.txt', ?, ?, ?)`
    )
    .run(communicationId, extractedText ? 'attempted_succeeded' : 'not_attempted', extractedText ?? null, contentHash);
  return Number(res.lastInsertRowid);
}

test('translateFocusSelection processes everything pending and skips everything already translated', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });

  const freshComm = insertCommunication(db, datasetId, 'bonjour le monde');
  insertAttachment(db, freshComm, 'texte extrait');

  const alreadyDoneComm = insertCommunication(db, datasetId, 'deja traduit');
  db.prepare('UPDATE communications SET translatedAt = ? WHERE id = ?').run(Date.now(), alreadyDoneComm);
  const alreadyDoneAtt = insertAttachment(db, alreadyDoneComm, 'piece jointe deja traduite');
  db.prepare('UPDATE attachments SET translatedAt = ? WHERE id = ?').run(Date.now(), alreadyDoneAtt);

  const noTextComm = insertCommunication(db, datasetId, 'pas de piece jointe utile');
  insertAttachment(db, noTextComm, null); // not_attempted -- nothing to translate

  callCount = 0;
  const result = await translateFocusSelection(db, [freshComm, alreadyDoneComm, noTextComm], 'rus');

  assert.equal(result.bodiesTranslated, 2, 'freshComm and noTextComm both had untranslated bodies');
  assert.equal(result.bodiesSkipped, 1, 'alreadyDoneComm was already translated');
  assert.equal(result.attachmentsTranslated, 1, 'only freshComm\'s attachment had extracted text and was pending');
  assert.equal(result.attachmentsSkipped, 1, 'alreadyDoneAtt was already translated');
  assert.equal(result.errors.length, 0);
  assert.equal(callCount, 3, 'exactly 3 real translation calls: 2 bodies + 1 attachment, never re-translating the done ones');

  // Re-running the exact same selection must not double-tap anything now.
  callCount = 0;
  const secondRun = await translateFocusSelection(db, [freshComm, alreadyDoneComm, noTextComm], 'rus');
  assert.equal(secondRun.bodiesTranslated, 0);
  assert.equal(secondRun.bodiesSkipped, 3);
  assert.equal(callCount, 0, 'nothing left pending -- a second run against the same selection makes zero AI calls');

  db.close();
});

test('translateFocusSelection deduplicates attachments by contentHash, calling the AI endpoint only once per unique document', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });

  // Bodies are pre-marked translated so this test isolates attachment
  // dedup specifically -- body translation is already covered by the
  // other test above.
  function markBodyDone(commId) {
    db.prepare('UPDATE communications SET translatedAt = ? WHERE id = ?').run(Date.now(), commId);
  }

  // Same underlying document attached to 3 different messages (e.g. the
  // real Aurora Spirit case's payment-ledger.xlsx, attached 4 times) --
  // same contentHash, 3 separate attachment rows.
  const commA = insertCommunication(db, datasetId, 'see attached ledger');
  markBodyDone(commA);
  const attA = insertAttachment(db, commA, 'ledger contents', 'same-hash-abc');
  const commB = insertCommunication(db, datasetId, 'forwarding the ledger');
  markBodyDone(commB);
  const attB = insertAttachment(db, commB, 'ledger contents', 'same-hash-abc');
  const commC = insertCommunication(db, datasetId, 'here is the ledger again');
  markBodyDone(commC);
  const attC = insertAttachment(db, commC, 'ledger contents', 'same-hash-abc');

  // A genuinely different document, unrelated hash, must still get its
  // own real translation.
  const commD = insertCommunication(db, datasetId, 'unrelated message');
  markBodyDone(commD);
  const attD = insertAttachment(db, commD, 'a totally different file', 'different-hash-xyz');

  callCount = 0;
  const result = await translateFocusSelection(db, [commA, commB, commC, commD], 'fas');

  assert.equal(result.attachmentsTranslated, 2, 'one real translation per unique contentHash group (ledger + the different doc)');
  assert.equal(result.attachmentsDeduped, 2, 'the other 2 ledger copies were filled in for free');
  assert.equal(callCount, 2, 'exactly 2 AI calls, never 4, despite 4 attachment rows');

  const rowA = db.prepare('SELECT translatedText, translatedAt FROM attachments WHERE id = ?').get(attA);
  const rowB = db.prepare('SELECT translatedText, translatedAt, translationMeta FROM attachments WHERE id = ?').get(attB);
  const rowC = db.prepare('SELECT translatedText, translatedAt FROM attachments WHERE id = ?').get(attC);
  assert.ok(rowA.translatedAt && rowB.translatedAt && rowC.translatedAt, 'every copy ends up translated');
  assert.equal(rowA.translatedText, rowB.translatedText, 'the copied text matches the one real translation exactly');
  assert.equal(rowA.translatedText, rowC.translatedText);
  const metaB = JSON.parse(rowB.translationMeta);
  assert.equal(metaB.dedupedFromAttachmentId, attA, 'the copy records which row the AI actually ran against');

  const rowD = db.prepare('SELECT translatedText FROM attachments WHERE id = ?').get(attD);
  assert.notEqual(rowD.translatedText, rowA.translatedText, 'the unrelated document got its own distinct translation');

  db.close();
});

test('previewFocusSelection computes the same counts without ever calling the AI endpoint', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });

  const freshComm = insertCommunication(db, datasetId, 'hola mundo');
  insertAttachment(db, freshComm, 'texto extraido');

  const alreadyDoneComm = insertCommunication(db, datasetId, 'ya traducido');
  db.prepare('UPDATE communications SET translatedAt = ? WHERE id = ?').run(Date.now(), alreadyDoneComm);

  callCount = 0;
  const preview = previewFocusSelection(db, [freshComm, alreadyDoneComm]);

  assert.equal(preview.bodiesPending, 1);
  assert.equal(preview.bodiesSkipped, 1);
  assert.equal(preview.attachmentsPending, 1);
  assert.equal(preview.attachmentsSkipped, 0);
  assert.equal(callCount, 0, 'preview must never reach the AI endpoint');

  db.close();
});
