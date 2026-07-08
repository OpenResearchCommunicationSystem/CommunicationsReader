import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';
import { indexCommunicationText } from '../src/search/token-index.js';
import { parseQuery } from '../src/search/query-parser.js';
import { evaluateQuery } from '../src/search/evaluate.js';
import { narrowCandidates } from '../src/search/candidate-narrow.js';
import { runSearch } from '../src/search/run-search.js';
import { listCommunications } from '../src/db/query.js';

function insertCommunication(db, datasetId, { subject = null, bodyText = null, fromRaw = null, toRaw = null } = {}) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, fromRaw, toRaw, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(datasetId, subject, bodyText, fromRaw, toRaw, `raw-${Math.random()}`, `norm-${Math.random()}`, Date.now());
  const id = Number(res.lastInsertRowid);
  indexCommunicationText(db, { id, subject, bodyText, fromRaw, toRaw });
  return id;
}

// A shared, deliberately varied fixture set, reused by every "narrowed
// must equal full-scan" comparison below.
function buildFixture() {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  insertCommunication(db, datasetId, { subject: 'Wire transfer confirmation', bodyText: 'Please send the wallet transfer today', fromRaw: 'alice@example.com' });
  insertCommunication(db, datasetId, { subject: 'Invoice attached', bodyText: 'See the transfer details in the attached invoice', fromRaw: 'bob@example.com' });
  insertCommunication(db, datasetId, { subject: 'Re: Wire transfer confirmation', bodyText: 'Confirmed, funds transferred', fromRaw: 'alice@example.com' });
  insertCommunication(db, datasetId, { subject: 'Team lunch', bodyText: 'Anyone free for lunch on Friday?', fromRaw: 'carol@example.com' });
  insertCommunication(db, datasetId, { subject: 'Contact: user@example.com', bodyText: 'Reach out via user@example.com for details', fromRaw: 'dave@example.com' });
  insertCommunication(db, datasetId, { subject: 'Meeting notes', bodyText: 'Discussed the my-term project timeline', fromRaw: 'erin@example.com' });
  return { db, datasetId };
}

// Full, unnarrowed scan -- exactly what runSearch used to always do
// before candidate-narrowing existed. The source of truth to compare
// narrowed results against.
function fullScanSearch(db, datasetId, query) {
  const ast = parseQuery(query);
  const communications = listCommunications(db, { datasetIds: [datasetId] });
  const results = [];
  for (const c of communications) {
    const evaluated = evaluateQuery(ast, c);
    if (evaluated) results.push(c.id);
  }
  return results.sort((a, b) => a - b);
}

function narrowedSearch(db, datasetId, query) {
  const result = runSearch(db, { datasetIds: [datasetId], query });
  return result.results.map((r) => r.communicationId).sort((a, b) => a - b);
}

const QUERIES = [
  'transfer',
  'trans', // substring-of-a-word -- the case narrowing could get wrong
  '"wire transfer"', // phrase
  'wallet NEAR/5 transfer',
  'subject:wire',
  'wallet OR lunch',
  'transfer AND NOT confirmed',
  'NOT lunch',
  '/wallet|invoice/i', // regex leaf -- must fall back to full scan safely
  'user@example.com', // term with non-word-char punctuation embedded
  'my-term', // hyphenated term split across two tokens by the indexer
  'nonexistenttermxyz',
];

for (const query of QUERIES) {
  test(`narrowed search matches full-scan results exactly for: ${query}`, () => {
    const { db, datasetId } = buildFixture();
    const expected = fullScanSearch(db, datasetId, query);
    const actual = narrowedSearch(db, datasetId, query);
    assert.deepEqual(actual, expected, `query ${JSON.stringify(query)} should return identical results narrowed vs full-scan`);
    db.close();
  });
}

test('narrowCandidates returns null (cannot narrow) for a bare regex', () => {
  const { db } = buildFixture();
  const ast = parseQuery('/foo/');
  assert.equal(narrowCandidates(db, ast), null);
  db.close();
});

test('narrowCandidates returns null for NOT', () => {
  const { db } = buildFixture();
  const ast = parseQuery('NOT wallet');
  assert.equal(narrowCandidates(db, ast), null);
  db.close();
});

test('narrowCandidates returns null for OR when either side is unnarrowable', () => {
  const { db } = buildFixture();
  const ast = parseQuery('wallet OR /foo/');
  assert.equal(narrowCandidates(db, ast), null);
  db.close();
});

test('narrowCandidates narrows AND to the intersection even when one side is unnarrowable', () => {
  const { db, datasetId } = buildFixture();
  const walletId = insertCommunication(db, datasetId, { bodyText: 'a wallet mention' });
  const ast = parseQuery('wallet AND /foo/');
  const candidates = narrowCandidates(db, ast);
  assert.notEqual(candidates, null);
  assert.ok(candidates.has(walletId));
  db.close();
});

test('narrowCandidates on a substring term returns a real (non-null) candidate set that is a superset of the true matches', () => {
  const { db, datasetId } = buildFixture();
  const ast = parseQuery('trans');
  const candidates = narrowCandidates(db, ast);
  assert.notEqual(candidates, null);
  const trueMatches = fullScanSearch(db, datasetId, 'trans');
  for (const id of trueMatches) {
    assert.ok(candidates.has(id), `true match ${id} must be included in the narrowed candidate set`);
  }
  db.close();
});
