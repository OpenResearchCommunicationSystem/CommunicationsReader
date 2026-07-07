import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractAndDetect } from '../src/parser/zip-extract.js';
import {
  buildEmlTreeZip,
  buildMboxZip,
  buildAmbiguousZip,
  buildUtf8FarsiEml,
  buildMboxFixture,
} from './fixtures/generate-fixtures.js';

async function writeZipToTemp(zipBuffer, name) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zip-extract-test-'));
  const zipPath = path.join(dir, name);
  await writeFile(zipPath, zipBuffer);
  return { dir, zipPath };
}

test('detects a single .mbox file as an mbox container', async () => {
  const { mboxBuffer } = buildMboxFixture();
  const zipBuffer = buildMboxZip(mboxBuffer);
  const { dir, zipPath } = await writeZipToTemp(zipBuffer, 'archive.zip');
  try {
    const result = await extractAndDetect(zipPath);
    assert.equal(result.containerType, 'mbox');
    assert.ok(result.mboxPath.endsWith('.mbox'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detects a tree of .eml files as an eml container', async () => {
  const zipBuffer = buildEmlTreeZip([
    { zipPath: 'Inbox/msg1.eml', content: buildUtf8FarsiEml() },
    { zipPath: 'Inbox/Nested/msg2.eml', content: buildUtf8FarsiEml() },
  ]);
  const { dir, zipPath } = await writeZipToTemp(zipBuffer, 'archive.zip');
  try {
    const result = await extractAndDetect(zipPath);
    assert.equal(result.containerType, 'eml');
    assert.equal(result.emlPaths.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('throws a clear top-level error when neither .mbox nor .eml content is found', async () => {
  const zipBuffer = buildAmbiguousZip();
  const { dir, zipPath } = await writeZipToTemp(zipBuffer, 'archive.zip');
  try {
    await assert.rejects(() => extractAndDetect(zipPath), /Unable to detect archive format/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
