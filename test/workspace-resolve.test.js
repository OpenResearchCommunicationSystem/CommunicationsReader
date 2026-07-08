import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRememberedWorkspace, rememberWorkspace, pointerFilePath } from '../src/workspace/resolve-workspace.js';
import { looksLikeExistingWorkspace, workspaceDbPath } from '../src/workspace/workspace-paths.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-resolve-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('readRememberedWorkspace returns null when no pointer file exists', async () => {
  await withTempDir(async (userDataDir) => {
    assert.equal(readRememberedWorkspace(userDataDir), null);
  });
});

test('rememberWorkspace + readRememberedWorkspace round-trips a valid workspace folder', async () => {
  await withTempDir(async (userDataDir) => {
    const workspaceDir = path.join(userDataDir, 'the-workspace');
    await mkdir(workspaceDir, { recursive: true });

    rememberWorkspace(userDataDir, workspaceDir);

    assert.equal(readRememberedWorkspace(userDataDir), workspaceDir);
  });
});

test('readRememberedWorkspace returns null when the remembered folder no longer exists', async () => {
  await withTempDir(async (userDataDir) => {
    const missingWorkspaceDir = path.join(userDataDir, 'unplugged-external-drive', 'the-workspace');
    rememberWorkspace(userDataDir, missingWorkspaceDir);

    assert.equal(readRememberedWorkspace(userDataDir), null);
  });
});

test('readRememberedWorkspace returns null when the pointer file is corrupt', async () => {
  await withTempDir(async (userDataDir) => {
    await mkdir(userDataDir, { recursive: true });
    await writeFile(pointerFilePath(userDataDir), '{ not valid json', 'utf8');

    assert.equal(readRememberedWorkspace(userDataDir), null);
  });
});

test('looksLikeExistingWorkspace detects a pre-workspace install (communications.db directly in userData)', async () => {
  await withTempDir(async (userDataDir) => {
    assert.equal(looksLikeExistingWorkspace(userDataDir), false);

    await mkdir(userDataDir, { recursive: true });
    await writeFile(workspaceDbPath(userDataDir), '', 'utf8');

    assert.equal(looksLikeExistingWorkspace(userDataDir), true);
  });
});
