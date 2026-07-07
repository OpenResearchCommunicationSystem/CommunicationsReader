const statementCache = new WeakMap();

function getStatements(db) {
  let stmts = statementCache.get(db);
  if (!stmts) {
    stmts = {
      insert: db.prepare(`
        INSERT INTO crypto_matches (
          communicationId, attachmentId, sourceField, matchType,
          matchedText, patternName, offset, context, createdAt
        ) VALUES (
          @communicationId, @attachmentId, @sourceField, @matchType,
          @matchedText, @patternName, @offset, @context, @createdAt
        )
      `),
      deleteByCommunication: db.prepare('DELETE FROM crypto_matches WHERE communicationId = ?'),
      deleteByAttachment: db.prepare('DELETE FROM crypto_matches WHERE attachmentId = ?'),
    };
    statementCache.set(db, stmts);
  }
  return stmts;
}

/**
 * Crypto matches are derived/recomputable, unlike raw imported
 * communications -- re-running a scan (e.g. after a keyword-list update)
 * should clear a row's prior matches first so results don't accumulate
 * duplicates. This is a deliberate difference from communications' dedup
 * policy (which never deletes).
 */
export function deleteCryptoMatchesFor(db, { communicationId, attachmentId }) {
  const stmts = getStatements(db);
  if (communicationId != null) stmts.deleteByCommunication.run(communicationId);
  if (attachmentId != null) stmts.deleteByAttachment.run(attachmentId);
}

export function insertCryptoMatches(db, matches) {
  const stmts = getStatements(db);
  const now = Date.now();
  for (const m of matches) {
    stmts.insert.run({
      communicationId: m.communicationId ?? null,
      attachmentId: m.attachmentId ?? null,
      sourceField: m.sourceField,
      matchType: m.matchType,
      matchedText: m.matchedText,
      patternName: m.patternName,
      offset: m.offset ?? null,
      context: m.context ?? null,
      createdAt: now,
    });
  }
}
