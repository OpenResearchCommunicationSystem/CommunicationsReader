import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTRACTION_WORKER_FILE = path.join(here, 'extraction-worker.js');

const DEFAULT_TIMEOUT_MS = 45_000;

// A full OS process per attachment (child_process) is too expensive in
// startup latency and memory duplication for potentially thousands of
// attachments on a resource-constrained laptop; worker_threads gives
// genuine crash isolation (an uncaught exception inside a worker surfaces
// as an 'error' event on the parent's Worker object, not a process
// crash) at a fraction of the cost. Capped at 2 concurrent given the
// laptop's constraints.
const MAX_CONCURRENT = 2;

let active = 0;
const queue = [];

function pump() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  active++;
  const job = queue.shift();
  runInWorker(job.workerFile, job.workerData, job.timeoutMs)
    .then(job.resolve, job.reject)
    .finally(() => {
      active--;
      pump();
    });
}

function runInWorker(workerFile, workerData, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData });
    let settled = false;
    let timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.terminate();
      fn(value);
    };

    timer = setTimeout(() => {
      finish(reject, new Error(`sandboxed extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(resolve, msg.result);
      else finish(reject, new Error(msg?.error || 'sandboxed extraction failed with no error detail'));
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => finish(reject, new Error(`extraction worker exited unexpectedly with code ${code}`)));
  });
}

/**
 * Queues { workerFile, workerData } for execution in an isolated
 * worker_thread, capped at MAX_CONCURRENT concurrent workers, with a
 * timeout that terminates a hung worker. Exported separately from
 * runSandboxedExtraction so tests can point at a small standalone
 * fixture worker script to exercise the crash/timeout machinery without
 * depending on real extractor behavior.
 */
export function runWorkerFile(workerFile, workerData, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    queue.push({ workerFile, workerData, timeoutMs, resolve, reject });
    pump();
  });
}

/**
 * Runs one attachment's extractor (docx/xlsx/pptx/pdf -- NOT image/OCR;
 * ocr.js already has its own crash-guard plus a persistent shared worker
 * reused across a whole batch, and wrapping it in a fresh per-call
 * worker_thread here would defeat that reuse) inside an isolated
 * worker_thread, so a crash or hang on one attacker-controlled file can
 * never take down the batch or the app.
 */
export function runSandboxedExtraction(kind, savedPath, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return runWorkerFile(EXTRACTION_WORKER_FILE, { kind, savedPath }, timeoutMs);
}
