import { simpleParser } from 'mailparser';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { computeRawHash, computeNormalizedHash } from './hash.js';
import { normalizeBody } from './body-normalize.js';
import { verifyMessageBodyEncoding } from './encoding-detect.js';

function addressToString(addressObject) {
  if (!addressObject) return null;
  if (typeof addressObject === 'string') return addressObject;
  if (addressObject.text) return addressObject.text;
  return null;
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

async function extractAttachments(parsedAttachments, outputAttachmentsDir, hashPrefix) {
  const list = parsedAttachments || [];
  if (!outputAttachmentsDir) {
    return list.map((att, i) => ({
      filename: att.filename || `attachment-${i}`,
      size: att.size ?? att.content?.length ?? 0,
      mimeType: att.contentType || 'application/octet-stream',
      savedPath: null,
    }));
  }

  await mkdir(outputAttachmentsDir, { recursive: true });
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const att = list[i];
    const safeName = (att.filename || `attachment-${i}`).replace(/[\\/:*?"<>|]/g, '_');
    const savedPath = path.join(outputAttachmentsDir, `${hashPrefix}-${i}-${safeName}`);
    await writeFile(savedPath, att.content);
    results.push({
      filename: att.filename || `attachment-${i}`,
      size: att.size ?? att.content?.length ?? 0,
      mimeType: att.contentType || 'application/octet-stream',
      savedPath,
    });
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
    rawHash.slice(0, 12)
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
