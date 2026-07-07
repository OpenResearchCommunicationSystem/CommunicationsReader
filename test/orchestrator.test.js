import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importArchive } from '../src/parser/index.js';
import { buildKitchenSinkZip, buildMboxZip, buildMboxFixture, MBOX_ESCAPED_LINE_BODY } from './fixtures/generate-fixtures.js';

async function writeZipToTemp(zipBuffer, name) {
  const dir = await mkdtemp(path.join(tmpdir(), 'orchestrator-test-'));
  const zipPath = path.join(dir, name);
  await writeFile(zipPath, zipBuffer);
  return { dir, zipPath };
}

test('end-to-end: eml-tree kitchen sink ZIP produces expected summary and quirks', async () => {
  const zipBuffer = buildKitchenSinkZip();
  const { dir, zipPath } = await writeZipToTemp(zipBuffer, 'kitchen-sink.zip');
  try {
    const result = await importArchive({ zipPath, outputAttachmentsDir: null });

    assert.equal(result.containerType, 'eml');
    // 9 entries total: 8 parseable + 1 malformed
    assert.equal(result.summary.total, 9);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.succeeded, 8);

    assert.ok(result.messages.some((m) => m.bodyEmpty === true), 'expected at least one empty-body message');
    assert.ok(result.messages.some((m) => m.messageId === null), 'expected the missing-message-id message');
    assert.ok(result.messages.some((m) => m.charsetOverridden === true), 'expected the mislabeled-charset message to be overridden');

    const rawHashes = result.messages.map((m) => m.rawHash);
    const uniqueRawHashes = new Set(rawHashes);
    assert.equal(uniqueRawHashes.size, rawHashes.length - 1, 'exactly one raw-hash duplicate pair expected');

    const normalizedHashes = result.messages.map((m) => m.normalizedHash);
    const normalizedCounts = new Map();
    for (const h of normalizedHashes) normalizedCounts.set(h, (normalizedCounts.get(h) || 0) + 1);
    const hasGroupOfAtLeastTwo = [...normalizedCounts.values()].some((c) => c >= 2);
    assert.ok(hasGroupOfAtLeastTwo, 'expected at least one normalized-hash group with 2+ members (dedup pair)');

    assert.equal(result.failures.length, 1);
    assert.ok(result.failures[0].sourceInfo.path.includes('malformed'));
    assert.ok(result.failures[0].error.message);

    const fullyPopulated = result.messages.find((m) => m.subject === 'Farsi UTF-8 happy path');
    assert.ok(fullyPopulated);
    for (const field of [
      'from', 'to', 'cc', 'subject', 'date', 'messageId', 'inReplyTo', 'references',
      'bodyText', 'bodyHtml', 'attachments', 'rawHash', 'normalizedHash', 'sourceInfo',
    ]) {
      assert.ok(field in fullyPopulated, `expected normalized message to have field: ${field}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('end-to-end: mbox ZIP recovers all messages with escaped body restored', async () => {
  const { mboxBuffer } = buildMboxFixture();
  const zipBuffer = buildMboxZip(mboxBuffer);
  const { dir, zipPath } = await writeZipToTemp(zipBuffer, 'mbox-archive.zip');
  try {
    const result = await importArchive({ zipPath, outputAttachmentsDir: null });
    assert.equal(result.containerType, 'mbox');
    assert.equal(result.summary.total, 4);
    assert.equal(result.summary.succeeded, 4);
    assert.equal(result.summary.failed, 0);

    const msg2 = result.messages.find((m) => m.subject === 'mbox message 2 (single-escape case)');
    assert.ok(msg2);
    assert.ok(msg2.bodyText.includes(MBOX_ESCAPED_LINE_BODY.split('\n')[1]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
