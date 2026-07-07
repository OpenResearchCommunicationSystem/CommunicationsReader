import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import { parseMessage } from '../src/parser/message-parse.js';
import {
  buildMissingMessageIdEml,
  buildEmptyBodyEml,
  buildMalformedMessage,
} from './fixtures/generate-fixtures.js';

test('missing Message-ID parses successfully with messageId null', async () => {
  const eml = buildMissingMessageIdEml();
  const normalized = await parseMessage(eml, { type: 'eml', path: 'missing-id.eml' });
  assert.equal(normalized.messageId, null);
  assert.equal(normalized.bodyEmpty, false);
});

test('empty-body fixture yields bodyEmpty: true', async () => {
  const eml = buildEmptyBodyEml();
  const normalized = await parseMessage(eml, { type: 'eml', path: 'empty-body.eml' });
  assert.equal(normalized.bodyEmpty, true);
});

test('malformed/unparseable message throws (caller is expected to catch)', async () => {
  const malformed = buildMalformedMessage();
  await assert.rejects(() => parseMessage(malformed, { type: 'eml', path: 'malformed.eml' }));
});

test('attachments are captured with filename/size/mimeType and written to disk', async () => {
  const raw = await buildEmlWithAttachment();
  const dir = await mkdtemp(path.join(tmpdir(), 'attach-test-'));
  try {
    const normalized = await parseMessage(raw, { type: 'eml', path: 'with-attachment.eml' }, {
      outputAttachmentsDir: dir,
    });
    assert.equal(normalized.attachments.length, 1);
    const att = normalized.attachments[0];
    assert.equal(att.filename, 'hello.txt');
    assert.equal(att.mimeType, 'text/plain');
    assert.ok(att.savedPath);
    const savedContent = await readFile(att.savedPath, 'utf8');
    assert.equal(savedContent, 'Attachment file contents.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function buildEmlWithAttachment() {
  const boundary = 'BOUNDARY123456';
  const attachmentContent = Buffer.from('Attachment file contents.', 'utf8').toString('base64');
  const raw =
    'From: Sender <sender@example.com>\r\n' +
    'To: Recipient <recipient@example.com>\r\n' +
    'Subject: Message with attachment\r\n' +
    'Message-ID: <with-attachment@example.com>\r\n' +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` +
    '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    '\r\n' +
    'See attached file.\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; name="hello.txt"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    'Content-Disposition: attachment; filename="hello.txt"\r\n' +
    '\r\n' +
    attachmentContent +
    '\r\n' +
    `--${boundary}--\r\n`;
  return Buffer.from(raw, 'utf8');
}

// Sanity check that our understanding of mailparser's attachment shape holds.
test('sanity: mailparser exposes attachment content as a Buffer', async () => {
  const raw = await buildEmlWithAttachment();
  const parsed = await simpleParser(raw, {});
  assert.equal(parsed.attachments.length, 1);
  assert.ok(Buffer.isBuffer(parsed.attachments[0].content));
});
