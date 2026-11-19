import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';

// Same AI-API mock boundary as test/summarize-thread.test.js --
// entity-extraction.js calls extractEntitiesViaAi() directly, but also
// imports buildThreadText from summarize-thread.js, which itself imports
// summarizeThreadViaAi from this same module -- mock.module replaces a
// module's ENTIRE export list with exactly what's given here, so every
// other export this file's transitive imports rely on needs a stub too,
// not just the one this suite actually exercises.
let lastPromptText = null;
let nextResponse = '[]';
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    summarizeThreadViaAi: async () => ({ text: '', meta: { summaryEngine: 'ai:mock:test' } }),
    extractEntitiesViaAi: async (text) => {
      lastPromptText = text;
      return { text: nextResponse, meta: { analysisEngine: 'ai:anthropic:claude-sonnet-5-5' } };
    },
  },
});

const { extractEntitiesForScope, getEntityExtraction } = await import('../src/forensics/entity-extraction.js');

function insertCommunication(db, datasetId, { subject, bodyText, timestamp }) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, timestamp, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, 'x', 'y', ?)`
    )
    .run(datasetId, subject ?? null, bodyText ?? null, timestamp ?? null, Date.now());
  return Number(res.lastInsertRowid);
}

test('extractEntitiesForScope parses the JSON response, persists it keyed by scope, and logs an audit event', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { subject: 'wire', bodyText: 'Alice sent $5,000 to Bob on Jan 1', timestamp: 1000 });

  nextResponse = '[{"type":"person","value":"Alice","context":"Alice sent $5,000"},{"type":"amount","value":"$5,000","context":"sent $5,000 to Bob"}]';

  try {
    const result = await extractEntitiesForScope(db, 'focus-set', [id1]);
    assert.equal(result.scope, 'focus-set');
    assert.equal(result.entities.length, 2);
    assert.equal(result.entities[0].value, 'Alice');
    assert.equal(result.provider, 'anthropic');
    assert.ok(lastPromptText.includes('Alice sent $5,000'));

    const saved = getEntityExtraction(db, 'focus-set');
    assert.equal(saved.entities.length, 2);
    assert.equal(saved.messageCount, 1);

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'entity_extraction_run' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.ok(event);
    assert.equal(event.subjectRef, 'focus-set');
    const payload = JSON.parse(event.payloadJson);
    assert.equal(payload.entityCount, 2);
  } finally {
    db.close();
  }
});

test('extractEntitiesForScope strips a markdown code fence before parsing, since some models wrap JSON in one anyway', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'hello', timestamp: 1000 });

  nextResponse = '```json\n[{"type":"other","value":"x","context":"y"}]\n```';

  try {
    const result = await extractEntitiesForScope(db, 'focus-set', [id1]);
    assert.equal(result.entities.length, 1);
  } finally {
    db.close();
  }
});

test('extractEntitiesForScope throws a clear error when the AI response is not valid JSON', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'hello', timestamp: 1000 });

  nextResponse = 'sure, here are the entities: Alice, Bob';

  try {
    await assert.rejects(() => extractEntitiesForScope(db, 'focus-set', [id1]), /not valid JSON/);
  } finally {
    db.close();
  }
});

test('extractEntitiesForScope overwrites (not accumulates) a prior extraction for the same scope', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'first', timestamp: 1000 });

  nextResponse = '[{"type":"other","value":"a","context":"a"}]';
  try {
    await extractEntitiesForScope(db, 'focus-set', [id1]);
    const id2 = insertCommunication(db, datasetId, { bodyText: 'second', timestamp: 2000 });
    nextResponse = '[{"type":"other","value":"a","context":"a"},{"type":"other","value":"b","context":"b"}]';
    await extractEntitiesForScope(db, 'focus-set', [id1, id2]);

    const rows = db.prepare('SELECT * FROM entity_extractions WHERE scope = ?').all('focus-set');
    assert.equal(rows.length, 1, 'regenerating must overwrite, not insert a second row');
    assert.equal(JSON.parse(rows[0].entitiesJson).length, 2);
  } finally {
    db.close();
  }
});

test('getEntityExtraction returns null for a scope that has never been extracted', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(getEntityExtraction(db, 'never-run'), null);
  } finally {
    db.close();
  }
});

test('extractEntitiesForScope throws a clear error for an empty communicationIds list', async () => {
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(() => extractEntitiesForScope(db, 'focus-set', []), /no communicationIds given/);
  } finally {
    db.close();
  }
});
