import unzipper from 'unzipper';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { walkForEmlFiles } from './eml-walk.js';

const FROM_SNIFF = Buffer.from('From ');

async function findMboxCandidates(rootDir) {
  const candidates = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase().endsWith('.mbox')) {
          candidates.push(fullPath);
        } else if (!entry.name.includes('.')) {
          // Extensionless file: sniff first bytes for the mbox "From "
          // delimiter signature before treating it as a candidate.
          const fd = await readFile(fullPath);
          if (fd.subarray(0, FROM_SNIFF.length).equals(FROM_SNIFF)) {
            candidates.push(fullPath);
          }
        }
      }
    }
  }

  await walk(rootDir);
  return candidates;
}

/**
 * Extracts a ZIP archive to a fresh temp directory and detects whether its
 * contents are a single mbox file or a tree of .eml files.
 *
 * Uses unzipper rather than adm-zip: adm-zip reads the whole archive into
 * one in-memory buffer via fs.readFileSync, which hits Node's hard
 * ERR_FS_FILE_TOO_LARGE ceiling (2 GiB) on real-world multi-GB exports.
 * unzipper streams each entry to disk via ranged fs.createReadStream reads
 * and understands Zip64 central directories, so archive size isn't bounded
 * by Node's single-read limit.
 *
 * Returns { containerType: 'mbox' | 'eml', extractedPath, mboxPath?, emlPaths?, note? }
 */
export async function extractAndDetect(zipPath) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'email-reader-'));
  const directory = await unzipper.Open.file(zipPath);
  await directory.extract({ path: workDir, concurrency: 4 });

  const mboxCandidates = await findMboxCandidates(workDir);
  const emlPaths = await walkForEmlFiles(workDir);

  if (mboxCandidates.length > 0) {
    const note =
      emlPaths.length > 0
        ? `Archive contains both an mbox file and ${emlPaths.length} .eml file(s); treating as mbox container. .eml files were not processed.`
        : undefined;
    return {
      containerType: 'mbox',
      extractedPath: workDir,
      mboxPath: mboxCandidates[0],
      note,
    };
  }

  if (emlPaths.length > 0) {
    return {
      containerType: 'eml',
      extractedPath: workDir,
      emlPaths,
    };
  }

  throw new Error(
    `Unable to detect archive format: no .mbox file and no .eml files found in ${zipPath}`
  );
}
