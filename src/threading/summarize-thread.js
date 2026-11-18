import { listCommunications } from '../db/query.js';
import { summarizeThreadViaAi } from '../ai-assist/index.js';
import { appendEvent } from '../audit/audit-log.js';

function formatTimestamp(ts) {
  return typeof ts === 'number' ? new Date(ts).toISOString() : '(no date)';
}

/**
 * Builds one plain-text transcript block per member, in chronological
 * order, for handing to the AI as a single prompt. Prefers each
 * message's translatedText over bodyText when present, since an
 * investigator analyzing a thread wants the readable version, same
 * preference src/db/export-text.js already applies for exports. Only
 * message bodies are included, not attachment text -- the AI OCR/
 * translation pipeline already surfaces attachment content separately,
 * and folding it in here would make the transcript unreadably long for
 * threads with many attachments.
 */
export function buildThreadText(rows) {
  const sorted = [...rows].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  return sorted
    .map((row) => {
      const text = row.translatedText || row.bodyText || '(no body text)';
      return `[${formatTimestamp(row.timestamp)}] From: ${row.fromRaw || '(unknown)'} To: ${row.toRaw || '(unknown)'}\nSubject: ${row.subject || '(no subject)'}\n${text}`;
    })
    .join('\n\n---\n\n');
}

const upsertStatementCache = new WeakMap();
function getUpsertStatement(db) {
  let stmt = upsertStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO thread_summaries (threadId, summary, messageCount, provider, model, generatedAt)
      VALUES (@threadId, @summary, @messageCount, @provider, @model, @generatedAt)
      ON CONFLICT(threadId) DO UPDATE SET
        summary = excluded.summary,
        messageCount = excluded.messageCount,
        provider = excluded.provider,
        model = excluded.model,
        generatedAt = excluded.generatedAt
    `);
    upsertStatementCache.set(db, stmt);
  }
  return stmt;
}

// meta.summaryEngine is "ai:<provider>:<model>" (see ai-assist/index.js) --
// split on the first two colons only, since a model name itself may
// legitimately contain one (e.g. a self-hosted gateway's own naming).
function parseSummaryEngine(summaryEngine) {
  const firstColon = summaryEngine.indexOf(':');
  const secondColon = summaryEngine.indexOf(':', firstColon + 1);
  return {
    provider: summaryEngine.slice(firstColon + 1, secondColon),
    model: summaryEngine.slice(secondColon + 1),
  };
}

/**
 * Generates (or regenerates) a plain-language summary for one thread and
 * persists it, keyed by threadId -- same "read inputs, call the engine,
 * write result, log an audit event" shape as
 * src/translate/translate-record.js. communicationIds comes straight
 * from the renderer's already-assembled thread.members (see
 * src/threading/build-threads.js) rather than re-deriving thread
 * membership server-side from the threadId string alone, since there is
 * no "threads" table to look it up against -- a thread is just an
 * on-demand grouping of communications, not a persisted entity. This is
 * a triage aid for the investigator, not an evidentiary finding -- see
 * this project's "POC, not evidence" rule and providers/*.js's own
 * summarizeThread() comment.
 */
export async function analyzeThread(db, threadId, communicationIds) {
  if (!threadId) {
    throw new Error('analyzeThread: no threadId given');
  }
  if (!Array.isArray(communicationIds) || communicationIds.length === 0) {
    throw new Error('analyzeThread: no communicationIds given');
  }

  const rows = listCommunications(db, { ids: communicationIds });
  const text = buildThreadText(rows);

  const result = await summarizeThreadViaAi(text);
  if (!result) {
    throw new Error('analyzeThread: no AI endpoint configured (see ai-config.json in the case workspace folder)');
  }

  const { provider, model } = parseSummaryEngine(result.meta.summaryEngine);
  const generatedAt = Date.now();
  getUpsertStatement(db).run({
    threadId,
    summary: result.text,
    messageCount: rows.length,
    provider,
    model,
    generatedAt,
  });

  appendEvent(db, {
    eventType: 'thread_summary_run',
    subjectRef: threadId,
    payload: { threadId, messageCount: rows.length, communicationIds },
  });

  return { threadId, summary: result.text, messageCount: rows.length, provider, model, generatedAt };
}

/**
 * Reads back a previously saved summary, or null if this thread has
 * never been analyzed. messageCount on the returned row lets the UI
 * detect staleness (the thread's current member count no longer matches
 * what the summary was generated from) without calling the AI endpoint.
 */
export function getThreadSummary(db, threadId) {
  return db.prepare('SELECT * FROM thread_summaries WHERE threadId = ?').get(threadId) ?? null;
}
