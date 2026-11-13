import fs from 'node:fs';
import path from 'node:path';

/**
 * A "workspace" is a folder holding everything one case needs: the
 * sqlite database (communications + search index + audit log all live in
 * the single file -- see src/db/schema.js), extracted attachments, and
 * the OCR language cache. Kept together so the whole case is portable as
 * one folder -- e.g. living beside the source archive on an external
 * drive rather than trapped inside a specific machine's Electron
 * userData directory, which does not survive a machine reset (see the
 * VM-build SOP's per-machine disposability).
 */
export function workspaceDbPath(workspaceDir) {
  return path.join(workspaceDir, 'communications.db');
}

export function workspaceAttachmentsDir(workspaceDir) {
  return path.join(workspaceDir, 'attachments');
}

export function workspaceTessdataCacheDir(workspaceDir) {
  return path.join(workspaceDir, 'tessdata-cache');
}

// Per-workspace, never committed, never bundled -- the investigator (or a
// future settings UI) edits this file to point OCR/translation at
// whichever AI endpoint their organization has approved. See
// src/ai-assist/config.js for the file's shape.
export function workspaceAiConfigPath(workspaceDir) {
  return path.join(workspaceDir, 'ai-config.json');
}

/**
 * True when `dir` already holds a communications.db -- used to detect an
 * install from before workspaces existed (everything used to live
 * directly in Electron's userData). Existing casework must never go
 * silently invisible just because a workspace-selection prompt got added
 * later: an install that already has real data at this path is treated
 * as an existing workspace automatically, not offered up for the
 * "choose a new folder" prompt.
 */
export function looksLikeExistingWorkspace(dir) {
  return fs.existsSync(workspaceDbPath(dir));
}
