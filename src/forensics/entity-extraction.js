import { listCommunications } from '../db/query.js';
import { buildThreadText } from '../threading/summarize-thread.js';
import { extractEntitiesViaAi } from '../ai-assist/index.js';
import { appendEvent } from '../audit/audit-log.js';

// meta.analysisEngine is "ai:<provider>:<model>" (see ai-assist/index.js) --
// same split-on-first-two-colons as summarize-thread.js's
// parseSummaryEngine(), for the same reason (a model name may itself
// legitimately contain a colon).
function parseAnalysisEngine(analysisEngine) {
  const firstColon = analysisEngine.indexOf(':');
  const secondColon = analysisEngine.indexOf(':', firstColon + 1);
  return {
    provider: analysisEngine.slice(firstColon + 1, secondColon),
    model: analysisEngine.slice(secondColon + 1),
  };
}

// Defensive against models that wrap JSON in a markdown code fence even
// when explicitly told not to (confirmed necessary directly against a
// couple of real providers) -- stripped before parsing, never silently
// swallowed if the result still isn't valid JSON afterward.
function parseEntitiesJson(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`extractEntitiesForScope: AI response was not valid JSON: ${cleaned.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('extractEntitiesForScope: AI response JSON was not an array');
  }
  return parsed;
}

const upsertStatementCache = new WeakMap();
function getUpsertStatement(db) {
  let stmt = upsertStatementCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO entity_extractions (scope, entitiesJson, messageCount, provider, model, generatedAt)
      VALUES (@scope, @entitiesJson, @messageCount, @provider, @model, @generatedAt)
      ON CONFLICT(scope) DO UPDATE SET
        entitiesJson = excluded.entitiesJson,
        messageCount = excluded.messageCount,
        provider = excluded.provider,
        model = excluded.model,
        generatedAt = excluded.generatedAt
    `);
    upsertStatementCache.set(db, stmt);
  }
  return stmt;
}

/**
 * Runs (or re-runs) entity extraction over a set of communications and
 * persists it keyed by scope -- same "read inputs, call the engine,
 * write result, log an audit event" shape as
 * src/threading/summarize-thread.js's analyzeThread(), reusing its
 * buildThreadText() to assemble the transcript since that function has
 * nothing thread-specific in it (it just formats an arbitrary set of
 * communication rows). This is a triage aid, not an evidentiary finding --
 * see this project's "POC, not evidence" rule; an investigator still
 * verifies every entity against the actual source text.
 */
export async function extractEntitiesForScope(db, scope, communicationIds) {
  if (!scope) {
    throw new Error('extractEntitiesForScope: no scope given');
  }
  if (!Array.isArray(communicationIds) || communicationIds.length === 0) {
    throw new Error('extractEntitiesForScope: no communicationIds given');
  }

  const rows = listCommunications(db, { ids: communicationIds });
  const text = buildThreadText(rows);

  const result = await extractEntitiesViaAi(text);
  if (!result) {
    throw new Error('extractEntitiesForScope: no AI endpoint configured (see ai-config.json in the case workspace folder)');
  }

  const entities = parseEntitiesJson(result.text);
  const { provider, model } = parseAnalysisEngine(result.meta.analysisEngine);
  const generatedAt = Date.now();
  getUpsertStatement(db).run({
    scope,
    entitiesJson: JSON.stringify(entities),
    messageCount: rows.length,
    provider,
    model,
    generatedAt,
  });

  appendEvent(db, {
    eventType: 'entity_extraction_run',
    subjectRef: scope,
    payload: { scope, messageCount: rows.length, communicationIds, entityCount: entities.length },
  });

  return { scope, entities, messageCount: rows.length, provider, model, generatedAt };
}

/**
 * Reads back a previously saved entity list, or null if this scope has
 * never been run. messageCount lets the UI detect staleness the same way
 * src/threading/summarize-thread.js's getThreadSummary() does.
 */
export function getEntityExtraction(db, scope) {
  const row = db.prepare('SELECT * FROM entity_extractions WHERE scope = ?').get(scope);
  if (!row) return null;
  return { ...row, entities: JSON.parse(row.entitiesJson) };
}
