import { readFile } from 'node:fs/promises';
import { extractAndDetect } from './zip-extract.js';
import { splitMboxStream } from './mbox-split.js';
import { parseMessage } from './message-parse.js';

function headerSnippet(rawBytes, maxLen = 500) {
  return rawBytes.subarray(0, Math.min(rawBytes.length, maxLen)).toString('binary');
}

/**
 * Runs the full parsing pipeline against a ZIP archive: extract, detect
 * container format (mbox vs .eml tree), enumerate raw messages, and parse
 * each one defensively. One malformed message never aborts the batch --
 * its failure is recorded and the batch continues.
 *
 * Splitting/reading and parsing are interleaved per message rather than
 * collecting every raw message up front -- a real multi-GB mbox export
 * previously OOM'd here (Buffer.concat of the whole file, then every raw
 * message buffer alive at once before parsing began). Parsed messages
 * themselves are cheap to keep in memory: attachment bytes are written to
 * outputAttachmentsDir by parseMessage() and only a savedPath string comes
 * back, not the content (see message-parse.js), so peak memory is bounded
 * by one raw message in flight, not the whole corpus.
 *
 * Returns { containerType, messages: [...], failures: [...],
 * summary: { succeeded, failed, total }, note? }
 */
export async function importArchive({ zipPath, outputAttachmentsDir }) {
  const detected = await extractAndDetect(zipPath);

  const messages = [];
  const failures = [];
  let total = 0;

  async function handle(rawBytes, sourceInfo) {
    total += 1;
    try {
      const normalized = await parseMessage(rawBytes, sourceInfo, { outputAttachmentsDir });
      messages.push(normalized);
    } catch (err) {
      failures.push({
        sourceInfo,
        headerSnippet: headerSnippet(rawBytes),
        error: { message: err.message, stack: err.stack },
      });
    }
  }

  if (detected.containerType === 'mbox') {
    for await (const msg of splitMboxStream(detected.mboxPath)) {
      await handle(msg.rawBytes, { type: 'mbox', mboxPath: detected.mboxPath, offset: msg.startOffset });
    }
  } else {
    for (const emlPath of detected.emlPaths) {
      const rawBytes = await readFile(emlPath);
      await handle(rawBytes, { type: 'eml', path: emlPath });
    }
  }

  return {
    containerType: detected.containerType,
    note: detected.note,
    messages,
    failures,
    summary: {
      succeeded: messages.length,
      failed: failures.length,
      total,
    },
  };
}
