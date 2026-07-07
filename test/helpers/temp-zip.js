import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function writeZipToTemp(zipBuffer, name = 'archive.zip') {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-test-'));
  const zipPath = path.join(dir, name);
  await writeFile(zipPath, zipBuffer);
  return { dir, zipPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
