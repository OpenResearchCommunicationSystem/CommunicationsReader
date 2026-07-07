import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/search/query-parser.js';
import { evaluateQuery } from '../src/search/evaluate.js';

function communication(overrides = {}) {
  return {
    id: 1,
    subject: 'Re: shipping schedule',
    bodyText: 'Please send the wallet transfer to our usual contact as discussed.',
    fromRaw: 'alice@example.com',
    toRaw: 'bob@example.com',
    attachments: [],
    ...overrides,
  };
}

function run(query, comm) {
  return evaluateQuery(parseQuery(query), comm);
}

test('plain word matches case-insensitively in the body', () => {
  const result = run('WALLET', communication());
  assert.ok(result);
  assert.equal(result.hits[0].field, 'body');
  assert.equal(result.hits[0].matchedText.toLowerCase(), 'wallet');
});

test('returns null when nothing matches', () => {
  assert.equal(run('nonexistentterm', communication()), null);
});

test('field prefix restricts matching to that field only', () => {
  const comm = communication({ subject: 'invoice due', bodyText: 'no relevant terms here' });
  assert.ok(run('subject:invoice', comm));
  assert.equal(run('body:invoice', comm), null);
});

test('phrase match requires the exact substring', () => {
  const comm = communication({ bodyText: 'the crypto wallet was emptied yesterday' });
  assert.ok(run('"crypto wallet"', comm));
  assert.equal(run('"wallet crypto"', comm), null);
});

test('regex literal matches and reports the matched text', () => {
  const comm = communication({ bodyText: 'send to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 please' });
  const result = run('/0x[a-f0-9]{40}/i', comm);
  assert.ok(result);
  assert.equal(result.hits[0].matchedText.toLowerCase(), '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
});

test('NEAR/N matches when terms are within the given word distance', () => {
  const comm = communication({ bodyText: 'wallet address for the transfer is ready' });
  assert.ok(run('wallet NEAR/5 transfer', comm));
});

test('NEAR/N does not match when terms are farther apart than the given distance', () => {
  const comm = communication({
    bodyText: 'wallet one two three four five six seven eight nine ten transfer',
  });
  assert.equal(run('wallet NEAR/2 transfer', comm), null);
});

test('AND requires both sides to match', () => {
  const comm = communication({ bodyText: 'wallet and transfer both appear here' });
  assert.ok(run('wallet AND transfer', comm));
  assert.equal(run('wallet AND nonexistent', comm), null);
});

test('OR matches when either side matches', () => {
  const comm = communication({ bodyText: 'only wallet appears here' });
  assert.ok(run('wallet OR nonexistent', comm));
  assert.ok(run('nonexistent OR wallet', comm));
  assert.equal(run('nonexistentone OR nonexistenttwo', comm), null);
});

test('NOT matches when the inner term is absent, and vice versa', () => {
  const comm = communication({ bodyText: 'nothing suspicious in this message' });
  assert.ok(run('NOT wallet', comm));
  assert.equal(run('NOT nothing', comm), null);
});

test('matches attachment extractedText and reports the attachmentId', () => {
  const comm = communication({
    bodyText: 'see attached certificate',
    attachments: [{ id: 42, filename: 'cert.docx', extractedText: 'Certificate No: SGS-IR-2021-04521' }],
  });
  const result = run('SGS-IR-2021-04521', comm);
  assert.ok(result);
  assert.equal(result.hits[0].field, 'attachment');
  assert.equal(result.hits[0].attachmentId, 42);
});

test('attachment: field prefix excludes body/subject matches', () => {
  const comm = communication({
    subject: 'wallet report',
    bodyText: 'wallet mentioned here too',
    attachments: [{ id: 1, filename: 'a.docx', extractedText: 'no relevant terms' }],
  });
  assert.equal(run('attachment:wallet', comm), null);
  assert.ok(run('subject:wallet', comm));
});
