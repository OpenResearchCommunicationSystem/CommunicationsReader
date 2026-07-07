function boolify(row, fields) {
  if (!row) return row;
  for (const f of fields) {
    if (f in row) row[f] = !!row[f];
  }
  return row;
}

const COMM_BOOL_FIELDS = ['bodyEmpty', 'encodingUncertain', 'charsetOverridden'];

export function listDatasets(db) {
  return db.prepare('SELECT * FROM datasets ORDER BY importedAt DESC').all();
}

function attachParticipantsAndAttachments(db, communications) {
  const participantsStmt = db.prepare(
    'SELECT * FROM participants WHERE communicationId = ? ORDER BY role, sortOrder'
  );
  const attachmentsStmt = db.prepare('SELECT * FROM attachments WHERE communicationId = ?');

  for (const comm of communications) {
    boolify(comm, COMM_BOOL_FIELDS);
    comm.participants = participantsStmt.all(comm.id);
    comm.attachments = attachmentsStmt.all(comm.id);
  }
  return communications;
}

/**
 * Lists communications, optionally scoped to a set of dataset ids (the
 * "select one, multiple, or all datasets" requirement -- an empty/omitted
 * datasetIds means all datasets).
 *
 * options: { datasetIds?: number[], limit?: number, offset?: number,
 * orderBy?: 'timestamp' | 'createdAt' }
 */
export function listCommunications(db, options = {}) {
  const { datasetIds, limit, offset = 0, orderBy = 'timestamp' } = options;
  const orderColumn = orderBy === 'createdAt' ? 'createdAt' : 'timestamp';

  let sql = 'SELECT * FROM communications';
  const params = [];

  if (Array.isArray(datasetIds) && datasetIds.length > 0) {
    const placeholders = datasetIds.map(() => '?').join(', ');
    sql += ` WHERE datasetId IN (${placeholders})`;
    params.push(...datasetIds);
  }

  sql += ` ORDER BY ${orderColumn} ASC`;

  if (typeof limit === 'number') {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  const rows = db.prepare(sql).all(...params);
  return attachParticipantsAndAttachments(db, rows);
}

/**
 * Fetches one communication with its participants and attachments, or
 * null if no row with that id exists.
 */
export function getCommunication(db, id) {
  const row = db.prepare('SELECT * FROM communications WHERE id = ?').get(id);
  if (!row) return null;
  return attachParticipantsAndAttachments(db, [row])[0];
}

/**
 * Groups communications sharing the same hash (default: normalizedHash,
 * the cross-envelope/cross-dataset dedup signal; pass by: 'rawHash' for
 * exact-duplicate groups instead). Only returns groups with 2+ members.
 * Never used to skip/merge rows at insert time -- see insert.js -- this is
 * purely a query-time view for surfacing dedup groups to the UI.
 *
 * options: { datasetIds?: number[], by?: 'normalizedHash' | 'rawHash' }
 */
export function getDedupGroups(db, options = {}) {
  const { datasetIds, by = 'normalizedHash' } = options;
  const hashColumn = by === 'rawHash' ? 'rawHash' : 'normalizedHash';

  let whereClause = '';
  const params = [];
  if (Array.isArray(datasetIds) && datasetIds.length > 0) {
    const placeholders = datasetIds.map(() => '?').join(', ');
    whereClause = ` WHERE datasetId IN (${placeholders})`;
    params.push(...datasetIds);
  }

  const groupHashes = db
    .prepare(
      `SELECT ${hashColumn} AS hash, COUNT(*) AS count FROM communications${whereClause} GROUP BY ${hashColumn} HAVING COUNT(*) > 1`
    )
    .all(...params);

  const memberStmt = db.prepare(
    `SELECT id, datasetId, subject, substr(bodyText, 1, 200) AS bodyPreview, rawHash, normalizedHash FROM communications WHERE ${hashColumn} = ?`
  );

  return groupHashes.map((g) => ({
    hash: g.hash,
    count: g.count,
    members: memberStmt.all(g.hash),
  }));
}

/**
 * Lists crypto/keyword matches, optionally scoped to a set of dataset
 * ids. A match's dataset is resolved via its communication (bodyText
 * matches) or via its attachment's parent communication (extractedText
 * matches).
 *
 * options: { datasetIds?: number[], matchType?: string }
 */
export function getCryptoMatches(db, options = {}) {
  const { datasetIds, matchType } = options;

  let sql = `
    SELECT cm.*, COALESCE(c.datasetId, ac.datasetId) AS datasetId
    FROM crypto_matches cm
    LEFT JOIN communications c ON c.id = cm.communicationId
    LEFT JOIN attachments a ON a.id = cm.attachmentId
    LEFT JOIN communications ac ON ac.id = a.communicationId
  `;
  const conditions = [];
  const params = [];

  if (Array.isArray(datasetIds) && datasetIds.length > 0) {
    const placeholders = datasetIds.map(() => '?').join(', ');
    conditions.push(`COALESCE(c.datasetId, ac.datasetId) IN (${placeholders})`);
    params.push(...datasetIds);
  }
  if (matchType) {
    conditions.push('cm.matchType = ?');
    params.push(matchType);
  }
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  return db.prepare(sql).all(...params);
}
