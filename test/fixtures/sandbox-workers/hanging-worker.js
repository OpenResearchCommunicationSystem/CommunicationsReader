// Test-only worker script for extract-sandboxed-extract.test.js: never
// posts a message and never exits, simulating a library call that hangs
// forever on a hostile input. A bare unresolved Promise with no pending
// timers/handles does NOT keep a worker_thread's event loop alive --
// Node considers there's "no more work" and lets it exit on its own,
// which would make this fixture a no-op. An interval that's never
// cleared is a real pending handle, so it genuinely hangs until
// sandboxed-extract.js's timeout calls worker.terminate().
setInterval(() => {}, 60_000);
