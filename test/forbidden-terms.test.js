import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceTree } from './lib/scan-source-tree.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const denylistPath = path.join(repoRoot, 'test', 'forbidden-terms.json');
const FORBIDDEN_HASHES = new Set(JSON.parse(readFileSync(denylistPath, 'utf8')).sha256);

// Real leak-site domains and case-entity names are NEVER stored in this
// repo in plaintext -- only their sha256 hashes, in test/forbidden-
// terms.json (see this project's Claude memory:
// hardware_and_legal_constraints.md for the absolute rule this
// enforces). This test can't "grep for the string" the normal way;
// instead it tokenizes scanned text into word/domain-like candidates,
// hashes each one, and checks for a match against the denylist --
// catching a regression the same way a literal grep would, without ever
// writing the real term into this repo or this test's own source.
//
// Scope boundary: this scans this repo's first-party source, scripts,
// docs, and test fixtures. It must NEVER scan
// C:\Users\Admin\.claude\projects\...\memory\* -- those are Claude's
// local session-memory files, outside this repo, never committed or
// published, and expected to retain real case specifics as legitimate
// working context.
const SCAN_ROOTS = ['electron', 'src', 'renderer', 'scripts', 'test', 'docs'];

// Matches bare word/identifier tokens and dotted domain-like tokens
// (word.word.word) in one pass -- covers both a single-word entity name
// and a leak-site domain.
const TOKEN_RE = /[a-z0-9]+(?:\.[a-z0-9]+)*/gi;

function hashToken(token) {
  return createHash('sha256').update(token.toLowerCase()).digest('hex');
}

function findDenylistedTerm(content) {
  const tokens = content.match(TOKEN_RE) || [];
  return tokens.some((token) => FORBIDDEN_HASHES.has(hashToken(token)));
}

test('no first-party file contains a denylisted case-specific/leak-site term', () => {
  const files = scanSourceTree(repoRoot, SCAN_ROOTS);
  // package.json lives at the repo root, outside every scanned subdirectory.
  files.push({
    filePath: path.join(repoRoot, 'package.json'),
    content: readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  });

  const violations = files
    .filter(({ content }) => findDenylistedTerm(content))
    .map(({ filePath }) => path.relative(repoRoot, filePath));

  assert.deepEqual(violations, [], `Found denylisted case-specific terms in:\n${violations.join('\n')}`);
});

test('the denylist itself is hash-only -- no plaintext term leaks into forbidden-terms.json', () => {
  const raw = readFileSync(denylistPath, 'utf8');
  assert.ok(!findDenylistedTerm(raw), 'forbidden-terms.json must only ever contain hashes, never the real terms');
});
