import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';
import { randomBytes } from 'node:crypto';

// Uses the Arabic-form yeh (U+064A) rather than the Farsi-specific yeh
// (U+06CC) because iconv-lite's windows1256 encoder has no mapping for the
// latter (silently substitutes '?') -- this string round-trips losslessly
// through windows-1256, which is what the flagship mislabeled-charset
// fixture needs to prove the override logic against known-good bytes.
export const FARSI_TEXT = 'سلام دنيا، اين يک پيام تستي است.';

let messageCounter = 0;

function defaultHeaders() {
  messageCounter++;
  return {
    From: 'Sender Name <sender@example.com>',
    To: 'Recipient Name <recipient@example.com>',
    Subject: `Test message ${messageCounter}`,
    Date: 'Mon, 06 Jul 2026 12:00:00 +0000',
    'Message-ID': `<test-${messageCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com>`,
  };
}

/**
 * Builds a raw RFC 5322 message buffer. Shared by both the .eml-tree and
 * mbox fixture builders so message-level quirks (charset, missing headers,
 * empty body) aren't duplicated across two fixture-authoring code paths.
 *
 * headers: object merged over sane defaults; set a key to null to omit it
 *   entirely (e.g. simulating a missing Message-ID).
 * body: string body, encoded as UTF-8 unless bodyBytes is given.
 * bodyBytes: raw pre-encoded body bytes (e.g. Windows-1256), used verbatim.
 * charset: value declared in the Content-Type header (may be a lie).
 * includeContentType: set false to omit the Content-Type header entirely.
 */
export function buildRawMessage({
  headers = {},
  body = '',
  bodyBytes = null,
  charset = 'utf-8',
  includeContentType = true,
} = {}) {
  const finalHeaders = { ...defaultHeaders(), ...headers };
  const lines = [];
  for (const [name, value] of Object.entries(finalHeaders)) {
    if (value === null || value === undefined) continue;
    lines.push(`${name}: ${value}`);
  }
  if (includeContentType) {
    lines.push(`Content-Type: text/plain; charset=${charset}`);
  }
  const headerBlock = lines.join('\r\n') + '\r\n\r\n';
  const bodyBuf = bodyBytes !== null ? bodyBytes : Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from(headerBlock, 'utf8'), bodyBuf]);
}

// --- Fixture 1: UTF-8 Farsi, correctly labeled -----------------------------
export function buildUtf8FarsiEml() {
  return buildRawMessage({
    headers: { Subject: 'Farsi UTF-8 happy path' },
    body: FARSI_TEXT,
    charset: 'utf-8',
  });
}

// --- Fixture 2: Windows-1256 Farsi mislabeled as UTF-8 ----------------------
export function buildWindows1256MislabeledEml() {
  const win1256Bytes = iconv.encode(FARSI_TEXT, 'windows1256');
  return buildRawMessage({
    headers: { Subject: 'Mislabeled charset flagship fixture' },
    bodyBytes: win1256Bytes,
    charset: 'utf-8', // the lie: bytes are actually windows-1256
  });
}

// --- Fixture 4: malformed header, missing Message-ID ------------------------
export function buildMissingMessageIdEml() {
  return buildRawMessage({
    headers: { Subject: 'No Message-ID here', 'Message-ID': null },
    body: 'A perfectly normal body, just missing a Message-ID header.',
  });
}

// --- Fixture 5: empty body --------------------------------------------------
export function buildEmptyBodyEml() {
  return buildRawMessage({
    headers: { Subject: 'Empty auto-reply' },
    body: '',
  });
}

// --- Fixture 7: dedup pair ---------------------------------------------------
export function buildDedupPair() {
  const identical = buildRawMessage({
    headers: { Subject: 'Byte-identical duplicate', 'Message-ID': '<identical-dup@example.com>' },
    body: 'This exact message was exported twice.',
  });

  const sameContentA = buildRawMessage({
    headers: {
      Subject: 'Forwarded thread',
      From: 'Alice <alice@example.com>',
      'Message-ID': '<same-content-a@example.com>',
    },
    body: 'This is the forwarded content.\nSecond line of content.',
  });

  const sameContentB = buildRawMessage({
    headers: {
      Subject: 'Forwarded thread',
      From: 'Alice <alice@example.com>',
      'Message-ID': '<same-content-b@example.com>',
      Received: 'from mail.example.com by relay.example.com; Mon, 06 Jul 2026 12:05:00 +0000',
    },
    body: 'This is the forwarded content.  \nSecond line of content.\n\n',
  });

  return {
    identicalA: identical,
    identicalB: Buffer.from(identical), // byte-for-byte copy
    sameContentA,
    sameContentB,
  };
}

// --- Fixture 8: genuinely malformed/unparseable -----------------------------
export function buildMalformedMessage() {
  // No header/body separator, no header-like lines at all -- random bytes.
  return randomBytes(200);
}

// --- Fixture 3: mbox with escaped "From " lines -----------------------------
function escapeForMbox(rawMessageBytes) {
  const text = rawMessageBytes.toString('binary');
  const lines = text.split(/(?<=\n)/);
  const escaped = lines.map((line) => (/^>*From /.test(line) ? '>' + line : line));
  return Buffer.from(escaped.join(''), 'binary');
}

export const MBOX_ESCAPED_LINE_BODY = 'Here is some text.\nFrom this is not a new message\nMore text after.';
export const MBOX_DOUBLE_ESCAPED_LINE_BODY = 'Quoting someone:\n>From this was already quoted once\nEnd of quote.';

export function buildMboxFixture() {
  const msg1 = buildRawMessage({
    headers: { Subject: 'mbox message 1 (normal)' },
    body: 'A perfectly normal first message.',
  });
  const msg2 = buildRawMessage({
    headers: { Subject: 'mbox message 2 (single-escape case)' },
    body: MBOX_ESCAPED_LINE_BODY,
  });
  const msg3 = buildRawMessage({
    headers: { Subject: 'mbox message 3 (double-escape case)' },
    body: MBOX_DOUBLE_ESCAPED_LINE_BODY,
  });
  const msg4 = buildRawMessage({
    headers: { Subject: 'mbox message 4 (trailing, tests EOF finalization)' },
    body: 'The last message in the file, with no following delimiter line.',
  });

  const rawMessages = [msg1, msg2, msg3, msg4];
  const parts = [];
  for (const raw of rawMessages) {
    parts.push(Buffer.from('From mbox-envelope-sender Mon Jul 06 12:00:00 2026\n', 'ascii'));
    let escaped = escapeForMbox(raw);
    if (!escaped.toString('binary').endsWith('\n')) {
      escaped = Buffer.concat([escaped, Buffer.from('\n')]);
    }
    parts.push(escaped);
  }

  return { mboxBuffer: Buffer.concat(parts), rawMessages };
}

// --- ZIP packaging helpers ---------------------------------------------------

/**
 * entries: [{ zipPath: 'Inbox/2024/msg1.eml', content: Buffer }]
 */
export function buildEmlTreeZip(entries) {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.zipPath, entry.content);
  }
  return zip.toBuffer();
}

export function buildMboxZip(mboxBuffer, mboxFileName = 'export.mbox') {
  const zip = new AdmZip();
  zip.addFile(mboxFileName, mboxBuffer);
  return zip.toBuffer();
}

export function buildAmbiguousZip() {
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('This archive contains neither .eml nor .mbox content.', 'utf8'));
  return zip.toBuffer();
}

/**
 * Fixture 6 + integration coverage: a "kitchen sink" .eml-tree ZIP combining
 * fixtures 1, 4, 5, 7a, 7b, 8, distributed across nested subfolders to also
 * exercise the recursive directory walk.
 */
export function buildKitchenSinkZip() {
  const dedup = buildDedupPair();
  const entries = [
    { zipPath: 'Inbox/2024/farsi-utf8.eml', content: buildUtf8FarsiEml() },
    { zipPath: 'Inbox/2024/farsi-win1256-mislabeled.eml', content: buildWindows1256MislabeledEml() },
    { zipPath: 'Inbox/2024/Subfolder/missing-message-id.eml', content: buildMissingMessageIdEml() },
    { zipPath: 'Inbox/2024/Subfolder/empty-body.eml', content: buildEmptyBodyEml() },
    { zipPath: 'Sent/dup-a.eml', content: dedup.identicalA },
    { zipPath: 'Sent/dup-b.eml', content: dedup.identicalB },
    { zipPath: 'Sent/forward-a.eml', content: dedup.sameContentA },
    { zipPath: 'Sent/forward-b.eml', content: dedup.sameContentB },
    { zipPath: 'Corrupt/malformed.eml', content: buildMalformedMessage() },
  ];
  return buildEmlTreeZip(entries);
}
