import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceTree } from './lib/scan-source-tree.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// This project is published as general-purpose e-discovery/research
// software, not as software built for or branded around any one
// customer -- confirmed directly (2026-11): no government connection
// should be advertised anywhere in the published source, comments, or
// docs. Unlike test/forbidden-terms.test.js's denylist, these terms
// aren't secret, so they're listed here in plain sight rather than
// hashed -- that also makes it obvious at a glance what's banned and why.
//
// This is a word-token denylist, not a substring ban, specifically so a
// short acronym like "ato" can't false-positive against an unrelated
// identifier that merely contains those letters (e.g. "operator") --
// see findDenylistedTerm() below.
const SCAN_ROOTS = ['electron', 'src', 'renderer', 'scripts', 'test', 'docs'];
const THIS_FILE_NAME = 'no-government-references.test.js';

const BANNED_TOKENS = new Set([
  'government',
  'gov',
  'federal',
  'military',
  'dod',
  'pentagon',
  'genai.mil',
  'stig',
  'fedramp',
  'ato', // "Authority to Operate" -- the gov accreditation term, not the English word
]);

const TOKEN_RE = /[a-z0-9]+(?:\.[a-z0-9]+)*/gi;

function findBannedTerm(content) {
  const tokens = content.match(TOKEN_RE) || [];
  return tokens.find((token) => BANNED_TOKENS.has(token.toLowerCase()));
}

test('no first-party file advertises a government connection', () => {
  const files = scanSourceTree(repoRoot, SCAN_ROOTS).filter(
    ({ filePath }) => path.basename(filePath) !== THIS_FILE_NAME
  );
  files.push({
    filePath: path.join(repoRoot, 'package.json'),
    content: readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  });
  // Root-level docs (SECURITY.md, CONTRIBUTING.md, README.md, etc.) --
  // scanSourceTree() only walks subdirectories, so these are the one
  // other place a reference could hide.
  for (const name of readdirSync(repoRoot)) {
    if (!name.endsWith('.md')) continue;
    files.push({ filePath: path.join(repoRoot, name), content: readFileSync(path.join(repoRoot, name), 'utf8') });
  }

  const violations = files
    .map(({ filePath, content }) => ({ filePath, term: findBannedTerm(content) }))
    .filter(({ term }) => term)
    .map(({ filePath, term }) => `${path.relative(repoRoot, filePath)}: "${term}"`);

  assert.deepEqual(violations, [], `Found government-connection terms in:\n${violations.join('\n')}`);
});
