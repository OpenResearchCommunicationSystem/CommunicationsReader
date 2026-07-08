import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAutopsyCase } from '../src/import-autopsy/import-autopsy-case.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CASE_DIR = path.join(here, '..', 'sample-data', 'Autopsy-dummy-dataset-100', 'AutopsySample-Date');

test('importAutopsyCase: recovers all 100 emails from the sample Autopsy case', async () => {
  const result = await importAutopsyCase({ caseDir: CASE_DIR });

  assert.equal(result.containerType, 'autopsy-case');
  assert.equal(result.failures.length, 0, `expected no failures, got: ${JSON.stringify(result.failures)}`);
  assert.equal(result.messages.length, 100);
  assert.equal(result.summary.succeeded, 100);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.total, 100);
});

test('importAutopsyCase: spot-checks From/To/Subject/body/Message-ID fidelity reconstructed from Autopsy attributes', async () => {
  const result = await importAutopsyCase({ caseDir: CASE_DIR });

  const numune = result.messages.find((m) => m.subject === 'Numune gonderimi onayi');
  assert.ok(numune, 'expected to find the "Numune gonderimi onayi" message');
  assert.match(numune.from, /emre\.sahin@bogazicifinans\.com\.tr/);
  assert.match(numune.to, /mehmet\.yilmaz@anadolulojistik\.com\.tr/);
  assert.match(numune.bodyText, /Istenen numuneler bugun kargo ile gonderildi/);
  assert.ok(numune.messageId, 'expected Message-ID to be recovered from the raw Headers block');

  const forwarded = result.messages.find((m) => m.subject.includes('关于原油货款结算的安排'));
  assert.ok(forwarded, 'expected to find the forwarded Chinese-subject message');
  assert.match(forwarded.from, /robert\.chen@globaltradepartners\.com/);
});

test('importAutopsyCase: attachment-bearing messages keep correct From/To/Subject even though Autopsy lacks their envelope headers', async () => {
  const result = await importAutopsyCase({ caseDir: CASE_DIR });

  // Every message with an attachment loses Message-ID fidelity (Autopsy's
  // Headers attribute holds an inner MIME part's headers instead of the
  // envelope for these) -- but From/To/Subject/body must still be correct,
  // since those come from separately-reliable discrete attributes, not the
  // Headers blob. Also: no two distinct messages may collide on the same
  // non-null messageId (the bug this test guards against).
  const withAttachments = result.messages.filter((m) => m.attachments.length > 0);
  assert.ok(withAttachments.length >= 5, 'expected at least the 5 known attachment-bearing messages');
  for (const m of withAttachments) {
    assert.ok(m.from, `expected From to survive for attachment-bearing message: ${m.subject}`);
    assert.ok(m.to, `expected To to survive for attachment-bearing message: ${m.subject}`);
    assert.ok(m.subject, 'expected Subject to survive for attachment-bearing message');
  }

  const nonNullIds = result.messages.map((m) => m.messageId).filter(Boolean);
  assert.equal(new Set(nonNullIds).size, nonNullIds.length, 'expected no two messages to collide on the same messageId');
});

test('importAutopsyCase: attachments come through as metadata/hash stubs only, no savedPath', async () => {
  const result = await importAutopsyCase({ caseDir: CASE_DIR });

  const allAttachments = result.messages.flatMap((m) => m.attachments);
  assert.equal(allAttachments.length, 5, 'expected 5 attachments total, matching TSK_ASSOCIATED_OBJECT links');

  for (const att of allAttachments) {
    assert.equal(att.savedPath, null, `expected no savedPath for Autopsy-sourced attachment ${att.filename} (no reliable byte source)`);
    assert.match(att.contentHash, /^[0-9a-f]{32}$/, `expected Autopsy's own md5 as contentHash for ${att.filename}`);
  }

  const filenames = allAttachments.map((a) => a.filename).sort();
  assert.deepEqual(filenames, [
    'charter_party.pdf',
    'invoice.docx',
    'photo_forwarded.png',
    'photo_forwarded.png',
    'site_photo.png',
  ]);

  // Cross-check against the real attachments independently pulled from
  // this project's own source zip (see the conversation's md5 comparison)
  // -- Autopsy's md5 is proven correct, so this is a stronger assertion
  // than just "looks like a hash".
  const invoice = allAttachments.find((a) => a.filename === 'invoice.docx');
  assert.equal(invoice.contentHash, '780ba4b0f216fbf30d8777f0f1d7da35');
});
