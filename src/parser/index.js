import { readFile } from 'node:fs/promises';
import { extractAndDetect } from './zip-extract.js';
import { splitMbox } from './mbox-split.js';
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
 * Returns { containerType, messages: [...], failures: [...],
 * summary: { succeeded, failed, total }, note? }
 */
export async function importArchive({ zipPath, outputAttachmentsDir }) {
  const detected = await extractAndDetect(zipPath);

  const rawEntries = [];
  if (detected.containerType === 'mbox') {
    const mboxBuf = await readFile(detected.mboxPath);
    const { messages } = splitMbox(mboxBuf);
    for (const msg of messages) {
      rawEntries.push({
        rawBytes: msg.rawBytes,
        sourceInfo: { type: 'mbox', mboxPath: detected.mboxPath, offset: msg.startOffset },
      });
    }
  } else {
    for (const emlPath of detected.emlPaths) {
      const rawBytes = await readFile(emlPath);
      rawEntries.push({ rawBytes, sourceInfo: { type: 'eml', path: emlPath } });
    }
  }

  const messages = [];
  const failures = [];

  for (const entry of rawEntries) {
    try {
      const normalized = await parseMessage(entry.rawBytes, entry.sourceInfo, { outputAttachmentsDir });
      messages.push(normalized);
    } catch (err) {
      failures.push({
        sourceInfo: entry.sourceInfo,
        headerSnippet: headerSnippet(entry.rawBytes),
        error: { message: err.message, stack: err.stack },
      });
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
      total: rawEntries.length,
    },
  };
}
