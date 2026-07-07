import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMbox } from '../src/parser/mbox-split.js';
import {
  buildMboxFixture,
  MBOX_ESCAPED_LINE_BODY,
  MBOX_DOUBLE_ESCAPED_LINE_BODY,
} from './fixtures/generate-fixtures.js';

test('splits a 4-message mbox into exactly 4 raw buffers with byte offsets', () => {
  const { mboxBuffer } = buildMboxFixture();
  const { messages } = splitMbox(mboxBuffer);
  assert.equal(messages.length, 4);
  for (const m of messages) {
    assert.equal(typeof m.startOffset, 'number');
    assert.ok(Buffer.isBuffer(m.rawBytes));
  }
});

test('single-escaped ">From " body line unescapes back to "From " exactly', () => {
  const { mboxBuffer } = buildMboxFixture();
  const { messages } = splitMbox(mboxBuffer);
  const msg2Text = messages[1].rawBytes.toString('utf8');
  assert.ok(msg2Text.includes(MBOX_ESCAPED_LINE_BODY), 'body should be restored exactly, unescaped');
});

test('doubly-escaped ">>From " line unescapes to exactly one fewer ">"', () => {
  const { mboxBuffer } = buildMboxFixture();
  const { messages } = splitMbox(mboxBuffer);
  const msg3Text = messages[2].rawBytes.toString('utf8');
  assert.ok(msg3Text.includes(MBOX_DOUBLE_ESCAPED_LINE_BODY), 'double-escaped line should reduce by exactly one ">"');
});

test('the last message in the file is still captured (EOF finalization)', () => {
  const { mboxBuffer } = buildMboxFixture();
  const { messages } = splitMbox(mboxBuffer);
  const last = messages[messages.length - 1].rawBytes.toString('utf8');
  assert.ok(last.includes('The last message in the file'));
});

test('a "From " substring mid-line is never treated as a delimiter', () => {
  const buf = Buffer.from(
    'From envelope-sender Mon Jul 06 12:00:00 2026\n' +
      'Subject: test\r\n\r\n' +
      'Body text mentioning From within a line, not at line start.\n'
  );
  const { messages } = splitMbox(buf);
  assert.equal(messages.length, 1);
  assert.ok(messages[0].rawBytes.toString('utf8').includes('mentioning From within a line'));
});
