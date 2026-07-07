// Test-only worker script for extract-sandboxed-extract.test.js: throws
// synchronously at module evaluation, simulating an extractor library
// crashing the worker thread outright (rather than rejecting a promise).
throw new Error('intentional test crash');
