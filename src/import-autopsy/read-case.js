import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Autopsy's artifact_id/obj_id values are signed 64-bit integers that
// routinely fall outside JS's safe-integer range (e.g.
// -9223372036854775803) -- node:sqlite throws RangeError decoding these as
// a plain number unless the statement is opted into BigInt mode via
// setReadBigInts(). Only artifact_id needs this; obj_id/size stay small
// enough in practice to read as plain numbers.
function bigIntStatement(db, sql) {
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  return stmt;
}

/**
 * Opens an Autopsy case's autopsy.db read-only. caseDir is the folder
 * containing both the .aut file and autopsy.db (what Autopsy itself calls
 * the case directory).
 */
export function openCaseDb(caseDir) {
  const dbPath = path.join(caseDir, 'autopsy.db');
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * Lists every TSK_EMAIL_MSG artifact in the case. fileName is carried
 * along purely as a human-readable label (e.g. for sourceRef) -- this
 * project deliberately never reads the physical file Autopsy carved this
 * artifact from. Verified against this project's own sample case: every
 * file Autopsy exports to ModuleOutput (both the raw per-message carve and
 * its separately-carved attachments) comes back scrambled -- content
 * starting with a literal "TSK_CONTAINER_XOR1_..." marker followed by
 * garbage, confirmed NOT present anywhere in the original source archive.
 * Autopsy's own database rows (this query, getEmailAttributes(),
 * listAttachmentsForArtifact()) are unaffected -- their hashes were
 * verified byte-for-byte against the real source attachments independently
 * extracted from this project's own sample archive. So: read the DB,
 * never the exported files.
 */
export function listEmailArtifacts(db) {
  const stmt = bigIntStatement(
    db,
    `
    SELECT a.artifact_id AS artifactId, f.name AS fileName
    FROM blackboard_artifacts a
    JOIN blackboard_artifact_types t ON a.artifact_type_id = t.artifact_type_id
    JOIN tsk_files f ON f.obj_id = a.obj_id
    WHERE t.type_name = 'TSK_EMAIL_MSG'
  `
  );
  return stmt.all();
}

/**
 * Pivots an email artifact's blackboard_attributes rows into the fields
 * this project needs. Two different reliability tiers, found by direct
 * comparison against this project's own sample archive (see
 * import-autopsy-case.js's doc comment):
 *
 *  - E-Mail From/To, Subject, Date Sent/Received, Message (Plaintext) are
 *    populated consistently for every message, attachments or not.
 *  - The raw Headers text block is NOT consistent: for a message with an
 *    attachment (multipart MIME), Autopsy was observed to store only an
 *    inner MIME part's headers (e.g. just Content-Type/
 *    Content-Transfer-Encoding) rather than the outer envelope -- losing
 *    From/To/Subject/Date/Message-ID entirely for that row, even though
 *    every one of this project's sample attachment-bearing messages hit
 *    this. So Headers is used ONLY to opportunistically recover
 *    Message-ID/In-Reply-To/References (present and correct whenever the
 *    envelope headers happen to be there) -- never as the source of truth
 *    for From/To/Subject/Date, which always come from the first tier.
 */
export function getEmailAttributes(db, artifactId) {
  const stmt = db.prepare(`
    SELECT at.display_name AS name, attr.value_text AS text, attr.value_int64 AS int64
    FROM blackboard_attributes attr
    JOIN blackboard_attribute_types at ON at.attribute_type_id = attr.attribute_type_id
    WHERE attr.artifact_id = ?
  `);
  const byName = {};
  for (const row of stmt.all(artifactId)) {
    byName[row.name] = row;
  }
  const dateSent = byName['Date Sent']?.int64 ?? byName['Date Received']?.int64 ?? null;
  return {
    headers: byName['Headers']?.text ?? null,
    bodyPlaintext: byName['Message (Plaintext)']?.text ?? '',
    emailFrom: byName['E-Mail From']?.text ?? null,
    emailTo: byName['E-Mail To']?.text ?? null,
    subject: byName['Subject']?.text ?? null,
    dateSentUnixSeconds: dateSent === null ? null : Number(dateSent),
  };
}

// Message-ID/In-Reply-To/References lines, wherever they happen to appear
// in the raw Headers attribute text -- searched directly rather than
// requiring the whole "-----HEADERS-----"/"---END HEADERS--" block to look
// like a complete envelope, since it often isn't (see getEmailAttributes()
// above). This project's sample data always puts References on one line,
// space-separated -- matches that shape.
const MESSAGE_ID_RE = /^Message-ID:\s*(.+)$/im;
const IN_REPLY_TO_RE = /^In-Reply-To:\s*(.+)$/im;
const REFERENCES_RE = /^References:\s*(.+)$/im;

export function extractThreadingHeaders(headersAttrText) {
  if (!headersAttrText) return { messageId: null, inReplyTo: null, references: null };
  return {
    messageId: headersAttrText.match(MESSAGE_ID_RE)?.[1]?.trim() ?? null,
    inReplyTo: headersAttrText.match(IN_REPLY_TO_RE)?.[1]?.trim() ?? null,
    references: headersAttrText.match(REFERENCES_RE)?.[1]?.trim() ?? null,
  };
}

/**
 * Lists attachments Autopsy linked to the given email artifact via a
 * TSK_ASSOCIATED_OBJECT artifact (the Email Parser module's own
 * attachment-to-message linkage). Metadata only (filename/size/mimeType/
 * md5) -- deliberately does not resolve or return a path to Autopsy's
 * carved copy of the file; see listEmailArtifacts()'s doc comment for why
 * those exported files aren't safe to read. tsk_files.md5 is Autopsy's own
 * hash, verified reliable (matches the real content) even though the
 * corresponding exported file does not.
 */
export function listAttachmentsForArtifact(db, artifactId) {
  const stmt = db.prepare(`
    SELECT f.name AS fileName, f.size AS size, f.mime_type AS mimeType, f.md5 AS md5
    FROM blackboard_artifacts ao
    JOIN blackboard_artifact_types t ON ao.artifact_type_id = t.artifact_type_id
    JOIN blackboard_attributes attr ON attr.artifact_id = ao.artifact_id
    JOIN tsk_files f ON f.obj_id = ao.obj_id
    WHERE t.type_name = 'TSK_ASSOCIATED_OBJECT' AND attr.value_int64 = ?
  `);
  return stmt.all(artifactId);
}
