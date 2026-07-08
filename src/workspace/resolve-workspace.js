import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the app remembers which workspace folder to reopen on next
 * launch. Always inside Electron's userData -- itself never part of the
 * portable workspace, since it's a per-machine "last used" pointer, not
 * case data. A fresh machine (or a factory-reset one) simply has none of
 * these and falls back to prompting.
 */
export function pointerFilePath(userDataDir) {
  return path.join(userDataDir, 'workspace-pointer.json');
}

/**
 * Reads the remembered workspace folder, if any, and only returns it if
 * the folder still exists on disk -- an external drive can be unplugged,
 * or the machine holding userData can have been reset since last use, so
 * a stale pointer must never be trusted blindly. Returns null (never
 * throws) when there's nothing valid to reopen, in which case the caller
 * is expected to prompt the user to choose or create one.
 */
export function readRememberedWorkspace(userDataDir) {
  const pointerPath = pointerFilePath(userDataDir);
  if (!fs.existsSync(pointerPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    if (parsed.workspaceDir && fs.existsSync(parsed.workspaceDir)) {
      return parsed.workspaceDir;
    }
  } catch {
    // Corrupt/unreadable pointer file -- treat as "nothing remembered"
    // rather than crashing startup over a bookkeeping file.
  }
  return null;
}

export function rememberWorkspace(userDataDir, workspaceDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(pointerFilePath(userDataDir), JSON.stringify({ workspaceDir }, null, 2));
}
