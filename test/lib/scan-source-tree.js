import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'release', '.tessdata-cache']);
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.html', '.css']);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
}

/**
 * Walks the given root directories (relative to repoRoot) and returns
 * [{ filePath, content }] for every first-party text file found. Shared
 * by test/no-network-primitives.test.js and test/forbidden-terms.test.js,
 * both of which scan (different, overlapping) parts of the source tree
 * for specific tokens. A root that doesn't exist is silently skipped.
 */
export function scanSourceTree(repoRoot, roots) {
  const files = [];
  for (const root of roots) {
    const fullRoot = path.join(repoRoot, root);
    try {
      if (!statSync(fullRoot).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(fullRoot, files);
  }
  return files.map((filePath) => ({
    filePath,
    content: readFileSync(filePath, 'utf8'),
  }));
}
