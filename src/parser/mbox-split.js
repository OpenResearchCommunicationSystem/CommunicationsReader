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
 * Splits an mboxrd-format buffer into individual raw RFC 5322 messages.
 * Un-escapes ">From " (and ">>From ", etc.) body lines back to their
 * original form. Delimiter "From " envelope lines are discarded, never
 * passed through to the caller.
 *
 * Returns [{ startOffset, rawBytes }].
 */
export function splitMbox(buf) {
  const lines = splitLines(buf);
  const messages = [];

  let currentLines = [];
  let currentStartOffset = null;
  let hasPreambleContent = false;
  let byteOffset = 0;

  const finalize = () => {
    if (currentStartOffset !== null) {
      messages.push({
        startOffset: currentStartOffset,
        rawBytes: Buffer.concat(currentLines),
      });
    }
  };

  for (const lineBuf of lines) {
    if (isDelimiterLine(lineBuf)) {
      finalize();
      currentLines = [];
      currentStartOffset = byteOffset;
    } else if (currentStartOffset === null) {
      // Content before the first delimiter line: preamble, not a message.
      if (lineBuf.toString('utf8').trim().length > 0) {
        hasPreambleContent = true;
      }
    } else {
      currentLines.push(unescapeIfNeeded(lineBuf));
    }
    byteOffset += lineBuf.length;
  }

  // Explicit EOF finalization for the trailing message (no following
  // delimiter line to trigger it otherwise).
  finalize();

  return { messages, hasPreambleContent };
}
