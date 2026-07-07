import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursively walks a directory tree collecting absolute paths to every
 * .eml file found, regardless of depth or nesting layout.
 */
export async function walkForEmlFiles(rootDir) {
  const results = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.eml')) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}
