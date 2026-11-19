import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/schema.js';
import { insertDataset } from '../src/db/insert.js';

// Same AI-API mock boundary as test/entity-extraction.test.js (see its
// own comment on why summarizeThreadViaAi needs a stub here too, even
// though this suite never calls it) -- qa-chat.js calls askQuestionViaAi()
// directly. Records the conversation it was handed each call so tests
// can confirm history actually gets replayed, not just the latest
// question.
let lastConversation = null;
let nextAnswer = 'an answer';
mock.module('../src/ai-assist/index.js', {
  namedExports: {
    summarizeThreadViaAi: async () => ({ text: '', meta: { summaryEngine: 'ai:mock:test' } }),
    askQuestionViaAi: async (contextText, messages) => {
      lastConversation = messages;
      return { text: nextAnswer, meta: { analysisEngine: 'ai:anthropic:claude-sonnet-5-5' } };
    },
  },
});

const { askFollowUpQuestion, listQaMessages, clearQaConversation } = await import('../src/forensics/qa-chat.js');

function insertCommunication(db, datasetId, { bodyText, timestamp }) {
  const res = db
    .prepare(
      `INSERT INTO communications (datasetId, sourceType, bodyText, timestamp, rawHash, normalizedHash, createdAt)
       VALUES (?, 'email', ?, ?, 'x', 'y', ?)`
    )
    .run(datasetId, bodyText ?? null, timestamp ?? null, Date.now());
  return Number(res.lastInsertRowid);
}

test('askFollowUpQuestion persists the question and answer, in order, and logs an audit event', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'the shipment left on the 5th', timestamp: 1000 });

  nextAnswer = 'The shipment left on the 5th.';

  try {
    const result = await askFollowUpQuestion(db, 'focus-set', [id1], 'When did the shipment leave?');
    assert.equal(result.answer, 'The shipment left on the 5th.');
    assert.equal(result.provider, 'anthropic');

    const messages = listQaMessages(db, 'focus-set');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'When did the shipment leave?');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].content, 'The shipment left on the 5th.');
    assert.equal(messages[1].provider, 'anthropic');

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'qa_question_asked' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.ok(event);
    assert.equal(JSON.parse(event.payloadJson).question, 'When did the shipment leave?');
  } finally {
    db.close();
  }
});

test('askFollowUpQuestion replays prior history so a second question has the full conversation, not just itself', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'hello', timestamp: 1000 });

  nextAnswer = 'first answer';
  await askFollowUpQuestion(db, 'focus-set', [id1], 'first question');

  nextAnswer = 'second answer';
  await askFollowUpQuestion(db, 'focus-set', [id1], 'second question');

  try {
    assert.equal(lastConversation.length, 3, 'first Q, first A, then the new question');
    assert.equal(lastConversation[0].content, 'first question');
    assert.equal(lastConversation[1].content, 'first answer');
    assert.equal(lastConversation[2].content, 'second question');
  } finally {
    db.close();
  }
});

test('clearQaConversation wipes a scope\'s history and logs an audit event', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'hello', timestamp: 1000 });

  try {
    await askFollowUpQuestion(db, 'focus-set', [id1], 'a question');
    assert.equal(listQaMessages(db, 'focus-set').length, 2);

    clearQaConversation(db, 'focus-set');
    assert.equal(listQaMessages(db, 'focus-set').length, 0);

    const event = db
      .prepare(`SELECT * FROM audit_log WHERE eventType = 'qa_conversation_cleared' ORDER BY sequenceNumber DESC LIMIT 1`)
      .get();
    assert.ok(event);
  } finally {
    db.close();
  }
});

test('askFollowUpQuestion rejects an empty question without calling the AI endpoint', async () => {
  const db = openDatabase(':memory:');
  const datasetId = insertDataset(db, { sourceType: 'email-eml', originalPath: 'x.zip' });
  const id1 = insertCommunication(db, datasetId, { bodyText: 'hello', timestamp: 1000 });

  try {
    await assert.rejects(() => askFollowUpQuestion(db, 'focus-set', [id1], '   '), /empty question/);
    assert.equal(listQaMessages(db, 'focus-set').length, 0);
  } finally {
    db.close();
  }
});

test('listQaMessages returns an empty array for a scope that has never been asked anything', () => {
  const db = openDatabase(':memory:');
  try {
    assert.deepEqual(listQaMessages(db, 'never-asked'), []);
  } finally {
    db.close();
  }
});
