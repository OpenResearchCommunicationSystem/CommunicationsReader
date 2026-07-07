import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { importArchive } from '../src/parser/index.js';
import { runScan } from '../src/crypto-detect/run-scan.js';
import { deleteDataset } from '../src/db/delete-dataset.js';
import { buildEmlTreeZip, buildUtf8FarsiEml } from './fixtures/generate-fixtures.js';
import { writeZipToTemp } from './helpers/temp-zip.js';

test('deleteDataset cascades communications/participants/attachments/crypto_matches and removes the attachments directory', async () => {
  const { zipPath, cleanup } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'a1.eml', content: buildUtf8FarsiEml() }]),
    'dataset.zip'
  );
  const attachmentsDir = await mkdtemp(path.join(tmpdir(), 'delete-dataset-attach-'));
  const markerFile = path.join(attachmentsDir, 'marker.txt');
  await writeFile(markerFile, 'placeholder attachment file');

  try {
    const db = openDatabase(':memory:');
    const importResult = await importArchive({ zipPath, outputAttachmentsDir: null });
    const { datasetId } = insertImportResult(db, importResult, {
      sourceType: 'email-eml',
      originalPath: zipPath,
      attachmentsDir,
    });

    // Give the communication a crypto match to prove that side of the
    // cascade too (matches reference communicationId directly, not via
    // an attachment).
    db.prepare('UPDATE communications SET bodyText = ? WHERE datasetId = ?').run(
      'wallet address 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      datasetId
    );
    runScan(db, { datasetIds: [datasetId] });

    const beforeCounts = {
      communications: db.prepare('SELECT COUNT(*) AS c FROM communications WHERE datasetId = ?').get(datasetId).c,
      cryptoMatches: db.prepare('SELECT COUNT(*) AS c FROM crypto_matches').get().c,
    };
    assert.ok(beforeCounts.communications > 0);
    assert.ok(beforeCounts.cryptoMatches > 0);

    const result = await deleteDataset(db, datasetId);
    assert.equal(result.deleted, true);

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM datasets WHERE id = ?').get(datasetId).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM communications WHERE datasetId = ?').get(datasetId).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM crypto_matches').get().c, 0);

    await assert.rejects(() => stat(markerFile), 'attachments directory should have been removed from disk');

    db.close();
  } finally {
    await cleanup();
    await rm(attachmentsDir, { recursive: true, force: true });
  }
});

test('deleteDataset on a nonexistent id returns deleted: false without throwing', async () => {
  const db = openDatabase(':memory:');
  const result = await deleteDataset(db, 999999);
  assert.equal(result.deleted, false);
  db.close();
});
