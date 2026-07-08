import {
  openCaseDb,
  listEmailArtifacts,
  getEmailAttributes,
  listAttachmentsForArtifact,
  extractThreadingHeaders,
} from './read-case.js';
import { parseMessage } from '../parser/message-parse.js';

// A raw header value can't safely contain a literal CR/LF -- an embedded
// one would prematurely end the synthetic header line (and could inject a
// spoofed header line after it). Not a live security exposure (this buffer
// is only ever re-parsed internally, never transmitted), but cheap to
// guard against confusing the reconstruction.
function sanitizeHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Reconstructs a minimal raw RFC 5322 buffer for parseMessage() to consume,
 * so message content goes through the exact same header/address-list/
 * date/threading-field parsing as the raw-archive import path. From/To/
 * Subject/Date always come from Autopsy's discrete attributes (verified
 * reliable for every message); Message-ID/In-Reply-To/References are
 * included only when extractThreadingHeaders() actually found them in the
 * raw Headers text -- omitted otherwise, same as a real message genuinely
 * missing those headers (see read-case.js's getEmailAttributes() doc
 * comment for why the two are sourced differently).
 */
function buildSyntheticRawMessage(attributes, threadingHeaders) {
  const lines = [
    `From: ${sanitizeHeaderValue(attributes.emailFrom)}`,
    `To: ${sanitizeHeaderValue(attributes.emailTo)}`,
    `Subject: ${sanitizeHeaderValue(attributes.subject)}`,
  ];
  if (attributes.dateSentUnixSeconds !== null) {
    lines.push(`Date: ${new Date(attributes.dateSentUnixSeconds * 1000).toUTCString()}`);
  }
  if (threadingHeaders.messageId) lines.push(`Message-ID: ${sanitizeHeaderValue(threadingHeaders.messageId)}`);
  if (threadingHeaders.inReplyTo) lines.push(`In-Reply-To: ${sanitizeHeaderValue(threadingHeaders.inReplyTo)}`);
  if (threadingHeaders.references) lines.push(`References: ${sanitizeHeaderValue(threadingHeaders.references)}`);

  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${attributes.bodyPlaintext ?? ''}`, 'utf8');
}

/**
 * Maps Autopsy's TSK_ASSOCIATED_OBJECT-linked attachments into metadata-
 * only stubs -- filename/size/mimeType/hash, savedPath always null. There
 * is no reliable byte source for attachment content from an Autopsy case
 * alone (see read-case.js's doc comment); extraction/OCR will honestly
 * fail with "could not read file" for these rather than fabricate content.
 * If the investigator also has the original archive, importing it directly
 * through the existing raw-archive path gets real attachment content --
 * this module doesn't attempt to replace that.
 *
 * contentHash is Autopsy's own MD5 (verified against real content
 * independently for this project's sample case), not this project's usual
 * sha256 -- it will correctly dedupe Autopsy-sourced attachments against
 * each other, but won't cross-match a sha256-keyed contentHash from a
 * separately-run raw-archive import of the same underlying file.
 */
function mapAutopsyAttachments(autopsyAttachments) {
  return autopsyAttachments.map((att) => ({
    filename: att.fileName,
    size: att.size ?? null,
    mimeType: att.mimeType ?? null,
    savedPath: null,
    contentHash: att.md5 ?? null,
  }));
}

/**
 * Runs the import pipeline against an existing Autopsy case directory.
 * Treated as its own source module (the same conceptual slot a future
 * UFDR/SMS/chat importer would occupy) -- entirely independent of, and not
 * a substitute for, this project's own raw-archive import path.
 *
 * From/To/Subject/Date/body are recovered from Autopsy's discrete
 * attributes (verified reliable for every message, attachments or not).
 * Message-ID/In-Reply-To/References are recovered opportunistically from
 * Autopsy's raw Headers attribute when present -- observed to be missing
 * specifically for every attachment-bearing message in this project's
 * sample case (Autopsy stored an inner MIME part's headers instead of the
 * envelope for those), so those messages fall through to this project's
 * existing subject/participant-overlap threading fallback instead of
 * header-confirmed threading, same graceful degradation already built for
 * real-world messages missing threading headers. HTML body is not
 * recoverable this way (Autopsy doesn't attribute it separately);
 * attachments come through as hash/metadata stubs only, never real
 * content -- see mapAutopsyAttachments().
 *
 * Returns the same { containerType, note, messages, failures, summary }
 * shape as src/parser/index.js's importArchive(), so it can be passed
 * straight into the existing insertImportResult() unchanged.
 */
export async function importAutopsyCase({ caseDir }) {
  const db = openCaseDb(caseDir);
  const messages = [];
  const failures = [];

  try {
    const emailArtifacts = listEmailArtifacts(db);

    for (const artifact of emailArtifacts) {
      const artifactId = String(artifact.artifactId);
      const sourceInfo = { type: 'autopsy-case', caseDir, artifactId, fileName: artifact.fileName };

      try {
        const attributes = getEmailAttributes(db, artifact.artifactId);
        if (!attributes.emailFrom && !attributes.subject) {
          throw new Error('No usable From/Subject attributes found for this artifact');
        }
        const threadingHeaders = extractThreadingHeaders(attributes.headers);

        const rawBytes = buildSyntheticRawMessage(attributes, threadingHeaders);
        const parsed = await parseMessage(rawBytes, sourceInfo, {});
        const autopsyAttachments = listAttachmentsForArtifact(db, artifact.artifactId);
        parsed.attachments = mapAutopsyAttachments(autopsyAttachments);
        messages.push(parsed);
      } catch (err) {
        failures.push({
          sourceInfo,
          headerSnippet: null,
          error: { message: err.message, stack: err.stack },
        });
      }
    }
  } finally {
    db.close();
  }

  return {
    containerType: 'autopsy-case',
    note:
      "Message content reconstructed from Autopsy's own From/To/Subject/Date/body attributes " +
      '(verified reliable); Message-ID-based threading is only recovered where Autopsy\'s Headers ' +
      'attribute happens to include it (typically missing for attachment-bearing messages -- those ' +
      'fall back to subject/participant threading). Attachment bytes are not retrievable from this ' +
      'source -- attachments are metadata/hash stubs only.',
    messages,
    failures,
    summary: {
      succeeded: messages.length,
      failed: failures.length,
      total: messages.length + failures.length,
    },
  };
}
