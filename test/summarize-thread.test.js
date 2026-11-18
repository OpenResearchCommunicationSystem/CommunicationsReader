import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';

// Same AI-API mock boundary as test/translate.test.js -- summarize-thread.js
// calls summarizeThreadViaAi() directly (no intermediate module), so this
// is the only function that needs mocking here.
let lastPromptText = null;
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    summarizeThreadViaAi: async (text) => {
      lastPromptText = text;
      return { text: `Summary of ${text.split('\n\n---\n\n').length} message(s)`, meta: { summaryEngine: 'ai:anthropic:claude-sonnet-5-5' } };
    },
  },
});

const { buildThreadText, analyzeThread, getThreadSummary } = await import('../src/threading/summarize-thread.js');

function insertCommunication(db, datasetId, { subject, bodyText, translatedText, timestamp, fromRaw, toRaw }) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, subject, bodyText, translatedText, timestamp, fromRaw, toRaw, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?, 'x', 'y', ?)`
    )
    .run(datasetId, subject ?? null, bodyText ?? null, translatedText ?? null, timestamp ?? null, fromRaw ?? null, toRaw ?? null, Date.now());
  return Number(res.lastInsertRowid);
}

test('buildThreadText orders messages chronologically and prefers translatedText over bodyText', () => {
  const rows = [
    { id: 2, timestamp: 2000, subject: 'Re: deal', bodyText: 'original second', translatedText: 'translated second', fromRaw: 'b@x.com', toRaw: 'a@x.com' },
    { id: 1, timestamp: 1000, subject: 'deal', bodyText: 'original first', translatedText: null, fromRaw: 'a@x.com', toRaw: 'b@x.com' },
  ];
  const text = buildThreadText(rows);
  const firstIndex = text.indexOf('original first');
  const secondIndex = text.indexOf('translated second');
  assert.ok(firstIndex >= 0 && secondIndex >= 0);
  assert.ok(firstIndex < secondIndex, 'earlier timestamp must appear first');
  assert.ok(!text.includes('original second'), 'translatedText must be preferred over bodyText when present');
});

test('analyzeThread writes a thread_summaries row and logs an audit event', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { subject: 'deal', bodyText: 'first message', timestamp: 1000, fromRaw: 'a@x.com', toRaw: 'b@x.com' });
  const id2 = insertCommunication(db, datasetId, { subject: 'Re: deal', bodyText: 'second message', timestamp: 2000, fromRaw: 'b@x.com', toRaw: 'a@x.com' });

  try {
    const result = await analyzeThread(db, 'thr_test123', [id1, id2]);
    assert.equal(result.threadId, 'thr_test123');
    assert.equal(result.messageCount, 2);
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.model, 'claude-sonnet-5-5');
    assert.ok(result.summary.length > 0);
    assert.ok(lastPromptText.includes('first message') && lastPromptText.includes('second message'));

    const row = getThreadSummary(db, 'thr_test123');
    assert.equal(row.summary, result.summary);
    assert.equal(row.messageCount, 2);
    assert.equal(row.provider, 'anthropic');

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'thread_summary_run' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.ok(event);
    assert.equal(event.subjectRef, 'thr_test123');
    const payload = JSON.parse(event.payloadJson);
    assert.equal(payload.messageCount, 2);
    assert.deepEqual(payload.communicationIds, [id1, id2]);
  } finally {
    db.close();
  }
});

test('analyzeThread overwrites (not accumulates) a prior summary for the same threadId', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { subject: 'deal', bodyText: 'first', timestamp: 1000 });

  try {
    await analyzeThread(db, 'thr_dup', [id1]);
    const id2 = insertCommunication(db, datasetId, { subject: 'Re: deal', bodyText: 'second', timestamp: 2000 });
    await analyzeThread(db, 'thr_dup', [id1, id2]);

    const rows = db.prepare('SELECT * FROM thread_summaries WHERE threadId = ?').all('thr_dup');
    assert.equal(rows.length, 1, 'regenerating must overwrite, not insert a second row');
    assert.equal(rows[0].messageCount, 2);
  } finally {
    db.close();
  }
});

test('getThreadSummary returns null for a thread that has never been analyzed', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(getThreadSummary(db, 'thr_never_analyzed'), null);
  } finally {
    db.close();
  }
});

test('analyzeThread throws a clear error for an empty communicationIds list', async () => {
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(() => analyzeThread(db, 'thr_empty', []), /no communicationIds given/);
  } finally {
    db.close();
  }
});
