import { translateCommunication, translateAttachment } from './translate-record.js';

function parseMeta(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Copies an already-translated row's result onto another row with the
// same contentHash, without ever calling the AI endpoint again -- the
// translate-side counterpart to src/extract/run-extraction.js's own
// contentHash+kind dedup grouping. Writes directly rather than going
// through translate-record.js's statements, since those always call
// translateText()/the AI endpoint; this path must never do that.
function copyAttachmentTranslation(db, attachmentId, sourceRow) {
  db.prepare(
    `UPDATE attachments SET translatedText = ?, translatedLang = ?, translatedAt = ?, translationMeta = ? WHERE id = ?`
  ).run(
    sourceRow.translatedText,
    sourceRow.translatedLang,
    Date.now(),
    JSON.stringify({ ...parseMeta(sourceRow.translationMeta), dedupedFromAttachmentId: sourceRow.id }),
    attachmentId
  );
}

function groupByContentHash(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.contentHash ? `hash:${row.contentHash}` : `row:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

/**
 * Translates every not-yet-translated body/attachment-text across a set
 * of hand-selected communications (the Focus Set's "send this batch for
 * processing" action) -- never re-translates anything that already has a
 * translatedAt timestamp, so re-running the same selection (or a
 * selection that overlaps a previous one) never double-taps the AI
 * endpoint or burns tokens redoing work. One sourceLang applies to the
 * whole batch; this app has no source-language auto-detection, same
 * constraint as the single-item translate actions this wraps.
 *
 * Attachments are additionally deduped by contentHash (confirmed
 * necessary directly: the same attachment commonly appears across
 * several selected messages/mailboxes -- see payment-ledger.xlsx in the
 * Aurora Spirit test case, attached to 4 different messages). Only the
 * first occurrence in each contentHash group ever reaches the AI; every
 * other occurrence -- whether already translated elsewhere in the DB or
 * only duplicated within this batch -- gets the result copied onto it
 * for free. This mirrors run-extraction.js's own extraction-time dedup;
 * translation didn't have the equivalent until now.
 *
 * Never throws for an individual item's failure (e.g. no AI endpoint
 * configured, or a single bad call) -- each failure is collected in
 * result.errors and the batch continues, same defensive-loop shape as
 * src/extract/run-extraction.js.
 *
 * Returns { bodiesTranslated, bodiesSkipped, attachmentsTranslated,
 * attachmentsSkipped, attachmentsDeduped, errors: [{ type, id, message }] }.
 */
export async function translateFocusSelection(db, communicationIds, sourceLang) {
  const result = {
    bodiesTranslated: 0,
    bodiesSkipped: 0,
    attachmentsTranslated: 0,
    attachmentsSkipped: 0,
    attachmentsDeduped: 0,
    errors: [],
  };

  if (!Array.isArray(communicationIds) || communicationIds.length === 0) return result;

  for (const communicationId of communicationIds) {
    const comm = db.prepare('SELECT id, translatedAt FROM communications WHERE id = ?').get(communicationId);
    if (!comm) continue;
    if (comm.translatedAt) {
      result.bodiesSkipped++;
    } else {
      try {
        await translateCommunication(db, communicationId, sourceLang);
        result.bodiesTranslated++;
      } catch (err) {
        result.errors.push({ type: 'communication', id: communicationId, message: err.message });
      }
    }
  }

  const placeholders = communicationIds.map(() => '?').join(', ');
  const attachments = db
    .prepare(
      `SELECT id, contentHash, extractedText, translatedText, translatedLang, translationMeta, translatedAt
       FROM attachments WHERE communicationId IN (${placeholders})`
    )
    .all(...communicationIds)
    .filter((a) => a.extractedText); // nothing extracted yet -- not this action's job to extract

  for (const group of groupByContentHash(attachments)) {
    let sourceRow = group.find((a) => a.translatedAt);

    if (sourceRow) {
      result.attachmentsSkipped++; // the already-done row itself
    } else {
      const representative = group[0];
      try {
        await translateAttachment(db, representative.id, sourceLang);
        result.attachmentsTranslated++;
      } catch (err) {
        result.errors.push({ type: 'attachment', id: representative.id, message: err.message });
        continue; // nothing to copy to the rest of the group either
      }
      sourceRow = db
        .prepare('SELECT id, translatedText, translatedLang, translationMeta FROM attachments WHERE id = ?')
        .get(representative.id);
    }

    for (const att of group) {
      if (att.id === sourceRow.id || att.translatedAt) continue;
      copyAttachmentTranslation(db, att.id, sourceRow);
      result.attachmentsDeduped++;
    }
  }

  return result;
}

/**
 * Dry-run counterpart to translateFocusSelection() -- computes the exact
 * same processed/skipped/deduped breakdown WITHOUT calling the AI
 * endpoint, so the UI can show an explicit "N items will be processed, M
 * already done, K filled in free via dedup" confirmation before
 * committing to a real (potentially costly) batch call. Confirmed
 * directly by the investigator: no bulk AI action may ever run without
 * the investigator seeing a count first.
 */
export function previewFocusSelection(db, communicationIds) {
  const preview = { bodiesPending: 0, bodiesSkipped: 0, attachmentsPending: 0, attachmentsSkipped: 0, attachmentsDeduped: 0 };

  if (!Array.isArray(communicationIds) || communicationIds.length === 0) return preview;

  for (const communicationId of communicationIds) {
    const comm = db.prepare('SELECT id, translatedAt FROM communications WHERE id = ?').get(communicationId);
    if (!comm) continue;
    if (comm.translatedAt) preview.bodiesSkipped++;
    else preview.bodiesPending++;
  }

  const placeholders = communicationIds.map(() => '?').join(', ');
  const attachments = db
    .prepare(`SELECT id, contentHash, extractedText, translatedAt FROM attachments WHERE communicationId IN (${placeholders})`)
    .all(...communicationIds)
    .filter((a) => a.extractedText);

  for (const group of groupByContentHash(attachments)) {
    const alreadyDone = group.some((a) => a.translatedAt);
    if (alreadyDone) {
      preview.attachmentsSkipped++;
      preview.attachmentsDeduped += group.filter((a) => !a.translatedAt).length;
    } else {
      preview.attachmentsPending++; // one real AI call for the whole group
      preview.attachmentsDeduped += group.length - 1;
    }
  }

  return preview;
}
