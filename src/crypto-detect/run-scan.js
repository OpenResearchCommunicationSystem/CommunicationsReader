import { scanCommunication, scanAttachment } from './scan.js';
import { insertCryptoMatches, deleteCryptoMatchesFor } from '../db/crypto-write.js';
import { appendEvent } from '../audit/audit-log.js';

/**
 * Re-runnable batch scan over communications.bodyText and (already
 * extracted) attachments.extractedText for a dataset scope. Clears prior
 * matches for each row before inserting fresh ones, so this is safe to
 * call again after a keyword-list update. Never aborts on one row's
 * failure -- mirrors this project's other batch drivers.
 *
 * options: { datasetIds?: number[] }
 * Returns { scannedCount, matchCount, failures: [...] }.
 */
export function runScan(db, options = {}) {
  const { datasetIds } = options;
  const hasScope = Array.isArray(datasetIds) && datasetIds.length > 0;
  const scopeSql = hasScope ? `WHERE datasetId IN (${datasetIds.map(() => '?').join(', ')})` : '';

  const communications = db
    .prepare(`SELECT id, bodyText FROM communications ${scopeSql}`)
    .all(...(hasScope ? datasetIds : []));

  const attachmentScopeSql = hasScope
    ? `WHERE a.extractionStatus = 'attempted_succeeded' AND c.datasetId IN (${datasetIds.map(() => '?').join(', ')})`
    : "WHERE a.extractionStatus = 'attempted_succeeded'";

  const attachments = db
    .prepare(
      `SELECT a.id, a.extractedText FROM attachments a JOIN communications c ON c.id = a.communicationId ${attachmentScopeSql}`
    )
    .all(...(hasScope ? datasetIds : []));

  let scannedCount = 0;
  let matchCount = 0;
  const failures = [];

  for (const communication of communications) {
    try {
      deleteCryptoMatchesFor(db, { communicationId: communication.id });
      const matches = scanCommunication(communication);
      insertCryptoMatches(db, matches);
      matchCount += matches.length;
      scannedCount++;
    } catch (err) {
      failures.push({ communicationId: communication.id, error: err.message });
    }
  }

  for (const attachment of attachments) {
    try {
      deleteCryptoMatchesFor(db, { attachmentId: attachment.id });
      const matches = scanAttachment(attachment);
      insertCryptoMatches(db, matches);
      matchCount += matches.length;
      scannedCount++;
    } catch (err) {
      failures.push({ attachmentId: attachment.id, error: err.message });
    }
  }

  appendEvent(db, {
    eventType: 'scan_run',
    subjectRef: hasScope ? datasetIds.join(',') : null,
    payload: { datasetIds: hasScope ? datasetIds : null, scannedCount, matchCount, failureCount: failures.length },
  });

  return { scannedCount, matchCount, failures };
}
