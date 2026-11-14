import { simpleParser } from 'mailparser';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { computeRawHash, computeNormalizedHash, sha256 } from './hash.js';
import { normalizeBody } from './body-normalize.js';
import { verifyMessageBodyEncoding } from './encoding-detect.js';
import { checkRawSize, AttachmentLimitError } from '../extract/limits.js';

function addressToString(addressObject) {
  if (!addressObject) return null;
  if (typeof addressObject === 'string') return addressObject;
  if (addressObject.text) return addressObject.text;
  return null;
}

// Structured {name, address} pairs, preserved alongside the flattened
// display string above so downstream consumers (e.g. the DB layer's
// participant rows) never need to re-parse "Name <addr>, Name2 <addr2>"
// out of a joined string -- splitting on commas is ambiguous once display
// names can themselves contain commas.
function addressToList(addressObject) {
  if (!addressObject) return [];
  if (typeof addressObject === 'string') return [{ name: null, address: addressObject }];
  if (Array.isArray(addressObject.value)) {
    return addressObject.value.map((v) => ({ name: v.name || null, address: v.address || null }));
  }
  return [];
}

function toReferencesArray(references) {
  if (!references) return [];
  if (Array.isArray(references)) return references;
  return String(references).split(/\s+/).filter(Boolean);
}

function isEmptyText(text) {
  return !text || text.trim().length === 0;
}

function hasAnyHeaderLine(rawBytes) {
  const head = rawBytes.subarray(0, Math.min(rawBytes.length, 4096)).toString('binary');
  const headerBlock = head.split(/\r\n\r\n|\n\n/)[0];
  return /^[A-Za-z][A-Za-z0-9-]*:\s?/m.test(headerBlock);
}

// mailparser's simpleParser() already fully base64-decodes every
// attachment into memory before we ever see it (att.content) -- that
// one-time decode is inherent to the library and not something this
// function can prevent. What IS this function's job, and what it did
// NOT do before: make sure that decoded buffer never multiplies past
// this point. Two gates, both BEFORE any disk write, in this order:
//
// 1. Size limit (checkRawSize, same 100MB cap the extraction pipeline
//    already enforces -- just enforced here too, at first contact,
//    instead of only much later when an extractor finally reads the
//    file back off disk). An oversized attachment is never written at
//    all -- savedPath stays null, same as any other unsupported/
//    rejected attachment.
// 2. Dedup by content hash, scoped to this one import run (seenHashes,
//    shared across every message via src/parser/index.js). Confirmed
//    real-world need: some source mail-server exports are flat dumps
//    with no join table at all, so the exact same attachment gets
//    physically repeated in the raw export once per message it's
//    "attached" to -- without this, that writes the same bytes to disk
//    (and, later, feeds the same bytes through OCR/translation) once
//    per occurrence instead of once, period.
async function extractAttachments(parsedAttachments, outputAttachmentsDir, hashPrefix, seenHashes) {
  const list = parsedAttachments || [];
  const dedupMap = seenHashes ?? new Map();

  if (!outputAttachmentsDir) {
    return list.map((att, i) => ({
      filename: att.filename || `attachment-${i}`,
      size: att.size ?? att.content?.length ?? 0,
      mimeType: att.contentType || 'application/octet-stream',
      savedPath: null,
      contentHash: att.content ? sha256(att.content) : null,
    }));
  }

  await mkdir(outputAttachmentsDir, { recursive: true });
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const att = list[i];
    const size = att.size ?? att.content?.length ?? 0;
    const contentHash = att.content ? sha256(att.content) : null;
    const base = {
      filename: att.filename || `attachment-${i}`,
      size,
      mimeType: att.contentType || 'application/octet-stream',
      contentHash,
    };

    if (att.content) {
      try {
        checkRawSize(att.content.length);
      } catch (err) {
        if (err instanceof AttachmentLimitError) {
          results.push({ ...base, savedPath: null });
          continue;
        }
        throw err;
      }
    }

    const existingPath = contentHash ? dedupMap.get(contentHash) : null;
    let savedPath = existingPath;
    if (!savedPath) {
      const safeName = base.filename.replace(/[\\/:*?"<>|]/g, '_');
      savedPath = path.join(outputAttachmentsDir, `${hashPrefix}-${i}-${safeName}`);
      await writeFile(savedPath, att.content);
      if (contentHash) dedupMap.set(contentHash, savedPath);
    }

    results.push({ ...base, savedPath });
  }
  return results;
}

/**
 * Parses a single raw RFC 5322 message buffer into a normalized message
 * object. Throws on genuinely malformed input (no recognizable header
 * block) -- callers (the orchestrator) are expected to catch this per
 * message and continue the batch.
 */
export async function parseMessage(rawBytes, sourceInfo, options = {}) {
  if (!hasAnyHeaderLine(rawBytes)) {
    throw new Error('No RFC 5322 header block found; message appears malformed/truncated');
  }

  const rawHash = computeRawHash(rawBytes);
  const parsed = await simpleParser(rawBytes, {});

  let bodyText = parsed.text || '';
  let bodyHtml = parsed.html || null;
  let charsetOverridden = false;
  let encodingUncertain = false;

  try {
    const verification = verifyMessageBodyEncoding(rawBytes);
    if (verification) {
      encodingUncertain = verification.encodingUncertain;
      if (verification.charsetOverridden) {
        if (verification.contentType === 'text/plain') {
          bodyText = verification.text;
          charsetOverridden = true;
        } else if (verification.contentType === 'text/html') {
          bodyHtml = verification.text;
          charsetOverridden = true;
        }
      }
    }
  } catch {
    // Best-effort verification pass; on any failure, keep mailparser's own decode.
  }

  const bodyEmpty = isEmptyText(bodyText) && isEmptyText(bodyHtml);

  const attachments = await extractAttachments(
    parsed.attachments,
    options.outputAttachmentsDir,
    rawHash.slice(0, 12),
    options.seenAttachmentHashes
  );

  const normalizedBody = normalizeBody(bodyText);
  const normalizedHash = computeNormalizedHash(normalizedBody, {
    subject: parsed.subject,
    from: addressToString(parsed.from),
  });

  return {
    from: addressToString(parsed.from),
    to: addressToString(parsed.to),
    cc: addressToString(parsed.cc),
    fromList: addressToList(parsed.from),
    toList: addressToList(parsed.to),
    ccList: addressToList(parsed.cc),
    subject: parsed.subject || null,
    date: parsed.date ? parsed.date.getTime() : null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: toReferencesArray(parsed.references),
    bodyText,
    bodyHtml,
    bodyEmpty,
    attachments,
    rawHash,
    normalizedHash,
    encodingUncertain,
    charsetOverridden,
    sourceInfo,
  };
}
