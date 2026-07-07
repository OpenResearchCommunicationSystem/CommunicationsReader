import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { importArchive } from '../src/parser/index.js';
import { getThreadsForDatasets } from '../src/db/thread-query.js';
import { buildEmlTreeZip, buildDedupPair, buildKitchenSinkZip } from './fixtures/generate-fixtures.js';
import { writeZipToTemp } from './helpers/temp-zip.js';

test('cross-dataset subject+participant fallback threading merges same-conversation messages from two separate datasets', async () => {
  const dedup = buildDedupPair();

  const { zipPath: zipA, cleanup: cleanupA } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'forward-a.eml', content: dedup.sameContentA }]),
    'dataset-a.zip'
  );
  const { zipPath: zipB, cleanup: cleanupB } = await writeZipToTemp(
    buildEmlTreeZip([{ zipPath: 'forward-b.eml', content: dedup.sameContentB }]),
    'dataset-b.zip'
  );

  try {
    const db = openDatabase(':memory:');
    const importA = await importArchive({ zipPath: zipA, outputAttachmentsDir: null });
    const importB = await importArchive({ zipPath: zipB, outputAttachmentsDir: null });
    const { datasetId: idA } = insertImportResult(db, importA, { sourceType: 'email-eml', originalPath: zipA });
    const { datasetId: idB } = insertImportResult(db, importB, { sourceType: 'email-eml', originalPath: zipB });

    const threadsAllDatasets = getThreadsForDatasets(db, []);
    const mergedThread = threadsAllDatasets.find((t) => t.messageCount === 2);
    assert.ok(mergedThread, 'expected the two same-subject/overlapping-participant messages to merge into one thread');
    assert.equal(mergedThread.method, 'subject-fallback');
    const memberDatasetIds = mergedThread.members.map((m) => m.datasetId).sort();
    assert.deepEqual(memberDatasetIds, [idA, idB].sort(), 'thread should span both datasets');

    // Scoping to a single dataset should NOT merge across the other dataset.
    const threadsOnlyA = getThreadsForDatasets(db, [idA]);
    assert.ok(threadsOnlyA.every((t) => t.messageCount === 1));

    db.close();
  } finally {
    await cleanupA();
    await cleanupB();
  }
});

test('kitchen-sink dataset: dedup pairs thread-merge, unrelated fixtures stay singleton', async () => {
  const { zipPath, cleanup } = await writeZipToTemp(buildKitchenSinkZip(), 'kitchen-sink.zip');
  try {
    const db = openDatabase(':memory:');
    const importResult = await importArchive({ zipPath, outputAttachmentsDir: null });
    insertImportResult(db, importResult, { sourceType: 'email-eml', originalPath: zipPath });

    const threads = getThreadsForDatasets(db, []);
    // 8 successfully-parsed messages, but the kitchen sink deliberately
    // includes two dedup pairs (dup-a/dup-b: byte-identical; forward-a/
    // forward-b: same subject+participants, differing envelope) that
    // legitimately share subject+participants -- they SHOULD thread-merge.
    // That leaves 4 singletons (farsi-utf8, win1256-mislabeled,
    // missing-message-id, empty-body) + 2 merged pairs = 6 threads.
    assert.equal(threads.length, 6);
    const multiMemberThreads = threads.filter((t) => t.messageCount === 2);
    assert.equal(multiMemberThreads.length, 2);
    assert.ok(multiMemberThreads.every((t) => t.method === 'subject-fallback'));
    const singletons = threads.filter((t) => t.messageCount === 1);
    assert.equal(singletons.length, 4);
    assert.ok(singletons.every((t) => t.method === 'singleton'));

    db.close();
  } finally {
    await cleanup();
  }
});
