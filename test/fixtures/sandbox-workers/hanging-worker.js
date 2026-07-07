// Test-only worker script for extract-sandboxed-extract.test.js: never
// posts a message and never exits, simulating a library call that hangs
// forever on a hostile input. Used to verify sandboxed-extract.js's
// timeout + worker.terminate() path actually fires.
await new Promise(() => {});
