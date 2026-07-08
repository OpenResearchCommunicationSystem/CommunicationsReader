import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceTree } from './lib/scan-source-tree.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// This app is deliberately air-gapped -- a legal condition of the
// government casework it processes, not just a preference (see this
// project's Claude memory: hardware_and_legal_constraints.md). A prior
// manual audit confirmed zero network primitives anywhere in this repo;
// this test turns that one-time audit into a durable, automated gate so
// a future dependency bump or careless edit can't silently reintroduce
// one.
//
// Scope boundary: this only scans this repo's first-party source
// (electron/, src/, renderer/src/, scripts/) plus package.json. It must
// NEVER scan C:\Users\Admin\.claude\projects\...\memory\* -- those are
// Claude's local session-memory files, outside this repo, never
// committed or published, and expected to retain real working context.
const SCAN_ROOTS = ['electron', 'src', 'renderer/src', 'scripts'];
const THIS_FILE_NAME = 'no-network-primitives.test.js';

// Dev-machine-only tooling that legitimately needs network access, same
// category as `npm install` itself needing network -- never runs on the
// investigator's air-gapped machine, never ships in the packaged exe (not
// listed in package.json's build.files), and is the ONLY way to vendor
// third-party ONNX model weights that have no npm package (see that
// script's own header comment and the plan doc's model-bundling section).
// This is a narrow, explicitly-reasoned exception, not a general carve-out
// for scripts/ -- any other file in scripts/ is still held to the same
// zero-network bar as the shipped app.
const NETWORK_ALLOWED_FILES = new Set(['fetch-translation-models.mjs']);

const FORBIDDEN_PATTERNS = [
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'http.request/https.request', re: /\bhttps?\.request\s*\(/ },
  { name: 'net.connect', re: /\bnet\.connect\s*\(/ },
  { name: 'new WebSocket(', re: /\bnew\s+WebSocket\s*\(/ },
  { name: "require('http'|'https'|'net'|'dgram'|'tls')", re: /require\(\s*['"](http|https|net|dgram|tls)['"]\s*\)/ },
  { name: "import ... from 'node:http'|'node:https'|'node:net'|'node:dgram'|'node:tls'", re: /from\s+['"]node:(http|https|net|dgram|tls)['"]/ },
  { name: 'Electron autoUpdater', re: /\bautoUpdater\b/ },
];

test('no first-party source file contains a network primitive', () => {
  const files = scanSourceTree(repoRoot, SCAN_ROOTS);
  const violations = [];

  for (const { filePath, content } of files) {
    // Excluded so this file's own pattern list (which necessarily
    // contains the forbidden tokens as strings/regexes) doesn't flag
    // itself.
    if (path.basename(filePath) === THIS_FILE_NAME) continue;
    if (NETWORK_ALLOWED_FILES.has(path.basename(filePath))) continue;
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(content)) {
        violations.push(`${path.relative(repoRoot, filePath)}: contains forbidden pattern "${name}"`);
      }
    }
  }

  assert.deepEqual(violations, [], `Found network primitives in first-party source:\n${violations.join('\n')}`);
});

test('package.json has no electron-builder "publish" key (no auto-update network calls)', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.build?.publish, undefined);
});
