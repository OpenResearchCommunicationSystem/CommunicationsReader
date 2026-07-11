import { createReadStream } from 'node:fs';

const LF = 0x0a;
const FROM_BYTES = Buffer.from('From ');
const GT_BYTE = 0x3e; // '>'

function isDelimiterLine(lineBuf) {
  if (lineBuf.length < FROM_BYTES.length) return false;
  return lineBuf.subarray(0, FROM_BYTES.length).equals(FROM_BYTES);
}

function unescapeIfNeeded(lineBuf) {
  // Matches ^>+From  -- strip exactly one leading '>' byte.
  let i = 0;
  while (i < lineBuf.length && lineBuf[i] === GT_BYTE) i++;
  if (i === 0) return lineBuf;
  const rest = lineBuf.subarray(i);
  if (isDelimiterLine(rest)) {
    return lineBuf.subarray(1);
  }
  return lineBuf;
}

function splitLines(buf) {
  // Returns array of Buffers, each the raw bytes of a line INCLUDING its
  // trailing \n (and \r if present), except possibly the final line if the
  // file doesn't end with a newline.
  const lines = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === LF) {
      lines.push(buf.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < buf.length) {
    lines.push(buf.subarray(start));
  }
  return lines;
}

/**
 * Mboxrd message-boundary state machine, fed one raw line at a time.
 * Shared by splitMbox() (in-memory, lines from a whole buffer) and
 * splitMboxStream() (lines carried across streamed chunks) so both stay
 * byte-identical without duplicating the delimiter/unescape logic.
 * pushLine() returns the just-completed message when a new delimiter line
 * closes the previous one, else null; finish() returns the trailing
 * message at EOF (or null if the file was empty/preamble-only).
 */
class MboxAccumulator {
  #currentLines = [];
  #currentStartOffset = null;
  #byteOffset = 0;
  hasPreambleContent = false;

  #finalize() {
    if (this.#currentStartOffset === null) return null;
    return { startOffset: this.#currentStartOffset, rawBytes: Buffer.concat(this.#currentLines) };
  }

  pushLine(lineBuf) {
    let completed = null;
    if (isDelimiterLine(lineBuf)) {
      completed = this.#finalize();
      this.#currentLines = [];
      this.#currentStartOffset = this.#byteOffset;
    } else if (this.#currentStartOffset === null) {
      // Content before the first delimiter line: preamble, not a message.
      if (lineBuf.toString('utf8').trim().length > 0) {
        this.hasPreambleContent = true;
      }
    } else {
      this.#currentLines.push(unescapeIfNeeded(lineBuf));
    }
    this.#byteOffset += lineBuf.length;
    return completed;
  }

  finish() {
    return this.#finalize();
  }
}

/**
 * Splits an mboxrd-format buffer into individual raw RFC 5322 messages.
 * Un-escapes ">From " (and ">>From ", etc.) body lines back to their
 * original form. Delimiter "From " envelope lines are discarded, never
 * passed through to the caller.
 *
 * Whole-buffer variant -- fine for mbox files small enough to hold in
 * memory. For multi-GB mbox files, use splitMboxStream() instead (reading
 * the whole file into one buffer here previously hit Node's memory
 * allocation limits on real-world multi-GB exports).
 *
 * Returns [{ startOffset, rawBytes }].
 */
export function splitMbox(buf) {
  const acc = new MboxAccumulator();
  const messages = [];
  for (const lineBuf of splitLines(buf)) {
    const completed = acc.pushLine(lineBuf);
    if (completed) messages.push(completed);
  }
  const last = acc.finish();
  if (last) messages.push(last);
  return { messages, hasPreambleContent: acc.hasPreambleContent };
}

/**
 * Streaming counterpart to splitMbox() for mbox files too large to buffer
 * whole in memory. Reads the file in chunks via fs.createReadStream and
 * yields one message at a time as soon as its closing delimiter (or EOF)
 * is seen -- at any point only the current message's accumulated lines
 * plus a small chunk-boundary carry are held in memory, never the whole
 * file. Same delimiter/unescape semantics as splitMbox() (both are driven
 * by the same MboxAccumulator).
 *
 * Yields { startOffset, rawBytes }.
 */
export async function* splitMboxStream(filePath) {
  const acc = new MboxAccumulator();
  let carry = Buffer.alloc(0);

  for await (const chunk of createReadStream(filePath)) {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === LF) {
        const completed = acc.pushLine(data.subarray(start, i + 1));
        start = i + 1;
        if (completed) yield completed;
      }
    }
    carry = data.subarray(start);
  }

  if (carry.length > 0) {
    const completed = acc.pushLine(carry);
    if (completed) yield completed;
  }

  const last = acc.finish();
  if (last) yield last;
}
