import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { importArchive } from '../src/parser/index.js';
import { listDatasets, listCommunications, getCommunication } from '../src/db/query.js';
import { buildEmlTreeZip, buildUtf8FarsiEml, buildMissingMessageIdEml, buildMboxZip, buildMboxFixture } from './fixtures/generate-fixtures.js';
import { writeZipToTemp } from './helpers/temp-zip.js';

test('multi-dataset query filtering: one, multiple, and all datasets', async () => {
  const { zipPath: zipA, cleanup: cleanupA } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'a1.eml', content: buildUtf8FarsiEml() }]),
    'dataset-a.zip'
  );
  const { zipPath: zipB, cleanup: cleanupB } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'b1.eml', content: buildMissingMessageIdEml() }]),
    'dataset-b.zip'
  );
  const { mboxBuffer } = buildMboxFixture();
  const { zipPath: zipC, cleanup: cleanupC } = await writeZipToTemp(buildMboxZip(mboxBuffer), 'dataset-c.zip');

  try {
    const db = openDatabase(':memory:');

    const importA = await importArchive({ zipPath: zipA, outputAttachmentsDir: null });
    const importB = await importArchive({ zipPath: zipB, outputAttachmentsDir: null });
    const importC = await importArchive({ zipPath: zipC, outputAttachmentsDir: null });

    const { datasetId: idA } = insertImportResult(db, importA, { sourceType: 'email-eml', originalPath: zipA, label: 'A' });
    const { datasetId: idB } = insertImportResult(db, importB, { sourceType: 'email-eml', originalPath: zipB, label: 'B' });
    const { datasetId: idC } = insertImportResult(db, importC, { sourceType: 'email-mbox', originalPath: zipC, label: 'C' });

    const datasets = listDatasets(db);
    assert.equal(datasets.length, 3);

    const onlyA = listCommunications(db, { datasetIds: [idA] });
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0].datasetId, idA);

    const aAndB = listCommunications(db, { datasetIds: [idA, idB] });
    assert.equal(aAndB.length, 2);
    assert.ok(aAndB.every((c) => c.datasetId === idA || c.datasetId === idB));

    const all = listCommunications(db, {});
    assert.equal(all.length, 1 + 1 + 4); // A:1, B:1, C: 4 mbox messages

    db.close();
  } finally {
    await cleanupA();
    await cleanupB();
    await cleanupC();
  }
});

test('getCommunication returns a single row with participants and attachments attached', async () => {
  const { zipPath, cleanup } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'a1.eml', content: buildUtf8FarsiEml() }]),
    'dataset.zip'
  );
  try {
    const db = openDatabase(':memory:');
    const importResult = await importArchive({ zipPath, outputAttachmentsDir: null });
    insertImportResult(db, importResult, { sourceType: 'email-eml', originalPath: zipPath });

    const row = db.prepare('SELECT id FROM communications LIMIT 1').get();
    const full = getCommunication(db, row.id);

    assert.ok(full);
    assert.ok(Array.isArray(full.participants));
    assert.ok(Array.isArray(full.attachments));
    assert.ok(full.participants.some((p) => p.role === 'from'));
    assert.equal(typeof full.bodyEmpty, 'boolean', 'boolean columns should be coerced from 0/1');

    assert.equal(getCommunication(db, 999999), null);

    db.close();
  } finally {
    await cleanup();
  }
});
