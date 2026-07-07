// Run in an isolated child process (not under node:test) so the crash
// guard's real behavior -- does the OS process survive, not just "is the
// exception caught somewhere" -- can be observed directly. node:test's
// own uncaughtException instrumentation would otherwise flag this
// scenario as a test failure regardless of whether application code
// handled it, since it can't distinguish "handled by our guard" from
// "truly unhandled" -- see extract-ocr-crash-guard.test.js.
import { writeFile } from 'node:fs/promises';
import { extractImageOcr, terminateOcrWorker } from '../../src/extract/ocr.js';

const fakeJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  Buffer.from('garbage after a valid-looking header, not real jpeg data'.repeat(5)),
]);
const path = process.argv[2];
await writeFile(path, fakeJpeg);

try {
  await extractImageOcr(path);
  console.log('UNEXPECTED_SUCCESS');
} catch (err) {
  console.log('CAUGHT_CLEANLY:' + err.message);
} finally {
  await terminateOcrWorker();
}
