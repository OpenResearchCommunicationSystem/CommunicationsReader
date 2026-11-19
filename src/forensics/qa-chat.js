import { listCommunications } from '../db/query.js';
import { buildThreadText } from '../threading/summarize-thread.js';
import { askQuestionViaAi } from '../ai-assist/index.js';
import { appendEvent } from '../audit/audit-log.js';

// Same split-on-first-two-colons as entity-extraction.js/
// summarize-thread.js -- see either for why.
function parseAnalysisEngine(analysisEngine) {
  const firstColon = analysisEngine.indexOf(':');
  const secondColon = analysisEngine.indexOf(':', firstColon + 1);
  return {
    provider: analysisEngine.slice(firstColon + 1, secondColon),
    model: analysisEngine.slice(secondColon + 1),
  };
}

const insertStatementCache = new WeakMap();
function getInsertStatement(db) {
  let stmt = insertStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO qa_messages (scope, role, content, provider, model, createdAt)
      VALUES (@scope, @role, @content, @provider, @model, @createdAt)
    `);
    insertStatementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Returns every message in a scope's running Q&A conversation, oldest
 * first -- the full back-and-forth the investigator has built up asking
 * follow-up questions about that scope's collection.
 */
export function listQaMessages(db, scope) {
  return db.prepare('SELECT * FROM qa_messages WHERE scope = ? ORDER BY id ASC').all(scope);
}

/**
 * Wipes a scope's conversation so the investigator can start fresh --
 * e.g. after the Focus Set has changed enough that old answers no longer
 * apply. Deliberately a real delete, not a soft-hide: this is a working
 * aid, not an evidentiary record (audit_log already has every question
 * asked as its own event, independent of this table's contents).
 */
export function clearQaConversation(db, scope) {
  db.prepare('DELETE FROM qa_messages WHERE scope = ?').run(scope);
  appendEvent(db, { eventType: 'qa_conversation_cleared', subjectRef: scope, payload: { scope } });
}

/**
 * Asks one follow-up question about a scope's collection, replaying the
 * scope's prior Q&A history so the model has the full conversation (not
 * just the latest question), then persists both the question and the
 * answer as new rows. communicationIds is passed on every call (rather
 * than resolved from some stored scope definition) because, like the
 * Focus Set, the underlying collection can change between questions --
 * each answer reflects whatever the collection actually contains at the
 * moment it's asked, same spirit as the staleness check on thread/
 * collection summaries elsewhere in this app.
 */
export async function askFollowUpQuestion(db, scope, communicationIds, question) {
  if (!scope) {
    throw new Error('askFollowUpQuestion: no scope given');
  }
  if (!question || !question.trim()) {
    throw new Error('askFollowUpQuestion: empty question');
  }
  if (!Array.isArray(communicationIds) || communicationIds.length === 0) {
    throw new Error('askFollowUpQuestion: no communicationIds given');
  }

  const rows = listCommunications(db, { ids: communicationIds });
  const contextText = buildThreadText(rows);

  const history = listQaMessages(db, scope).map((m) => ({ role: m.role, content: m.content }));
  const conversation = [...history, { role: 'user', content: question }];

  const result = await askQuestionViaAi(contextText, conversation);
  if (!result) {
    throw new Error('askFollowUpQuestion: no AI endpoint configured (see ai-config.json in the case workspace folder)');
  }

  const { provider, model } = parseAnalysisEngine(result.meta.analysisEngine);
  const now = Date.now();
  const insert = getInsertStatement(db);
  insert.run({ scope, role: 'user', content: question, provider: null, model: null, createdAt: now });
  insert.run({ scope, role: 'assistant', content: result.text, provider, model, createdAt: now });

  appendEvent(db, {
    eventType: 'qa_question_asked',
    subjectRef: scope,
    payload: { scope, communicationIds, question },
  });

  return { question, answer: result.text, provider, model, askedAt: now };
}
