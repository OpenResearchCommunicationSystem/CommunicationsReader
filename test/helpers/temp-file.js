import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function writeBufferToTemp(buffer, name) {
  const dir = await mkdtemp(path.join(tmpdir(), 'extract-test-'));
  const filePath = path.join(dir, name);
  await writeFile(filePath, buffer);
  return { dir, filePath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
