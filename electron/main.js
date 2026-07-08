import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../src/db/schema.js';
import { readRememberedWorkspace, rememberWorkspace } from '../src/workspace/resolve-workspace.js';
import {
  workspaceDbPath,
  workspaceAttachmentsDir,
  workspaceTessdataCacheDir,
  looksLikeExistingWorkspace,
} from '../src/workspace/workspace-paths.js';
import { insertImportResult } from '../src/db/insert.js';
import { listDatasets, listCommunications, getCommunication as dbGetCommunication, getCryptoMatches } from '../src/db/query.js';
import { getThreadsForDatasets } from '../src/db/thread-query.js';
import { deleteDataset } from '../src/db/delete-dataset.js';
import { importArchive } from '../src/parser/index.js';
import { runExtraction } from '../src/extract/run-extraction.js';
import { AVAILABLE_LANGS, DEFAULT_LANGS } from '../src/extract/ocr.js';
import { AVAILABLE_LANGS as AVAILABLE_TRANSLATE_LANGS } from '../src/translate/translate.js';
import { translateCommunication, translateAttachment } from '../src/translate/translate-record.js';
import { runScan } from '../src/crypto-detect/run-scan.js';
import { runSearch } from '../src/search/run-search.js';
import { hashFileStreaming } from '../src/parser/hash.js';
import { appendEvent } from '../src/audit/audit-log.js';
import { addToFocusSet, removeFromFocusSet, clearFocusSet, listFocusSet } from '../src/db/focus-set.js';
import { materializeFocusSet } from '../src/db/materialize.js';
import { persistThreads } from '../src/threading/persist-threads.js';
import { importAutopsyCase } from '../src/import-autopsy/import-autopsy-case.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Read once at startup, not per-request -- package.json never changes
// while the app is running. Surfaced to the renderer via get-app-info so
// the running build number is visible in the UI, matching the same
// buildNumber baked into the packaged exe's Windows file-version resource
// (see scripts/bump-build-number.mjs).
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

let db;
let attachmentsRootDir;
let currentWorkspaceDir;

/**
 * Asks where to keep the case workspace (database + attachments + OCR
 * language cache -- see src/workspace/workspace-paths.js) if nothing was
 * remembered from last launch, or the remembered folder's drive isn't
 * currently reachable (unplugged external, or the machine was reset --
 * see the S5 VM-build workflow, where the host machine itself is
 * periodically disposable). Defaults to userData if the dialog is
 * cancelled, so a bare install still works with zero clicks, but the
 * whole point of asking is to let the case live next to its source
 * archives on the investigator's own case drive instead of being
 * trapped inside one machine's app-install folder.
 *
 * An install from before workspaces existed already has a
 * communications.db directly in userData -- that counts as "remembered"
 * too (and is recorded as such so future launches don't re-check the
 * filesystem for it), so upgrading never silently orphans real casework
 * behind a prompt for a new, empty folder.
 */
async function resolveWorkspaceDir(userDataDir) {
  const remembered = readRememberedWorkspace(userDataDir);
  if (remembered) return remembered;

  if (looksLikeExistingWorkspace(userDataDir)) {
    rememberWorkspace(userDataDir, userDataDir);
    return userDataDir;
  }

  const result = await dialog.showOpenDialog({
    title: 'Choose (or create) a folder for the case database',
    message:
      'This folder holds the search index, extracted text, and audit log. Pick a location on your case drive so it travels with your source files, not the app install.',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: userDataDir,
  });
  const chosen = result.canceled || result.filePaths.length === 0 ? userDataDir : result.filePaths[0];
  rememberWorkspace(userDataDir, chosen);
  return chosen;
}

function initStorage(workspaceDir) {
  currentWorkspaceDir = workspaceDir;
  const dbPath = workspaceDbPath(workspaceDir);
  attachmentsRootDir = workspaceAttachmentsDir(workspaceDir);
  // src/extract/ocr.js's traineddata cache must live outside the
  // (read-only, once packaged) app directory -- see its own comment.
  process.env.TESSDATA_CACHE_DIR = workspaceTessdataCacheDir(workspaceDir);
  db = openDatabase(dbPath);
  appendEvent(db, {
    eventType: 'app_launch',
    payload: { version: pkg.version, buildNumber: pkg.buildNumber, buildVersion: pkg.build?.buildVersion, workspaceDir },
  });
}

/**
 * Lets the investigator point the app at a different case workspace
 * later (e.g. switching to a different case's external drive). Simplest
 * safe implementation: remember the new folder, then relaunch the whole
 * app -- every renderer data source (datasets, threads, focus set) is
 * already fetched fresh on mount, so a clean relaunch is far less risky
 * than hand-rolling a live in-place database swap while windows are open.
 */
function registerWorkspaceMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Change Workspace Folder…',
          click: async () => {
            const userDataDir = app.getPath('userData');
            const result = await dialog.showOpenDialog({
              title: 'Choose (or create) a folder for the case database',
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: userDataDir,
            });
            if (result.canceled || result.filePaths.length === 0) return;
            rememberWorkspace(userDataDir, result.filePaths[0]);
            if (db) db.close();
            app.relaunch();
            app.exit();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.handle('get-app-info', () => ({
    version: pkg.version,
    buildNumber: pkg.buildNumber,
    buildVersion: pkg.build?.buildVersion,
    workspaceDir: currentWorkspaceDir,
  }));

  ipcMain.handle('list-datasets', () => listDatasets(db));

  ipcMain.handle('list-threads', (_event, datasetIds) => getThreadsForDatasets(db, datasetIds));

  ipcMain.handle('get-communication', (_event, id) => dbGetCommunication(db, id));

  ipcMain.handle('get-crypto-matches', (_event, datasetIds) => getCryptoMatches(db, { datasetIds }));

  ipcMain.handle('import-archive', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select an archive to import',
      properties: ['openFile'],
      filters: [{ name: 'Archives', extensions: ['zip', 'mbox'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const zipPath = result.filePaths[0];
    const label = path.basename(zipPath);
    const outputAttachmentsDir = path.join(attachmentsRootDir, `${Date.now()}-${label}`);
    await fs.mkdir(outputAttachmentsDir, { recursive: true });

    // Hash the whole source archive before extraction begins -- distinct
    // from the per-message rawHash/normalizedHash on communications,
    // this is a single fingerprint for the archive as the investigator
    // received it. Streaming read so this doesn't require loading a
    // near-TB archive fully into memory just to hash it.
    const archiveStat = await fs.stat(zipPath);
    const archiveSha256 = await hashFileStreaming(zipPath);
    appendEvent(db, {
      eventType: 'dataset_import_started',
      subjectRef: zipPath,
      payload: { archiveSha256, size: archiveStat.size, originalPath: zipPath, label },
    });

    const importResult = await importArchive({ zipPath, outputAttachmentsDir });
    const sourceType = importResult.containerType === 'mbox' ? 'email-mbox' : 'email-eml';
    // archiveSha256 makes this resumable: if the app is interrupted
    // mid-import (the laptop losing power/sleeping) and the investigator
    // re-imports the exact same file afterward, insertImportResult()
    // detects the matching in-progress archive hash and continues from
    // the last committed batch instead of restarting from message 0.
    const inserted = insertImportResult(db, importResult, {
      sourceType,
      originalPath: zipPath,
      label,
      attachmentsDir: outputAttachmentsDir,
      archiveSha256,
    });

    appendEvent(db, {
      eventType: 'dataset_import_completed',
      subjectRef: String(inserted.datasetId),
      payload: {
        datasetId: inserted.datasetId,
        archiveSha256,
        insertedCount: inserted.insertedCount,
        insertFailureCount: inserted.insertFailures.length,
        parseSummary: importResult.summary,
      },
    });

    // Extraction and crypto scanning run immediately after import so the
    // investigator doesn't need a separate step -- both are re-runnable
    // later (e.g. after a keyword-list update) via the same functions.
    await runExtraction(db, { datasetIds: [inserted.datasetId] });
    runScan(db, { datasetIds: [inserted.datasetId] });
    // Whole-DB rebuild (not scoped to this dataset) -- threading can link
    // messages across datasets, see persistThreads()'s own comment.
    persistThreads(db);

    return {
      datasetId: inserted.datasetId,
      label,
      parseSummary: importResult.summary,
      insertedCount: inserted.insertedCount,
    };
  });

  // Imports an existing Autopsy case as its own independent source module
  // (same conceptual slot a future UFDR/SMS/chat importer would occupy) --
  // not a substitute for import-archive, and not dependent on it. Reads
  // only autopsy.db's own records (parsed Headers/Message-Plaintext
  // attributes, hashes): Autopsy's exported ModuleOutput file copies were
  // found to be unreliable against this project's sample case (scrambled
  // on export, verified via independent hash comparison against the real
  // source archive), while the database rows themselves check out, so
  // this project never reads those exported files -- see
  // src/import-autopsy/read-case.js. Attachments come through as metadata/
  // hash stubs only (no retrievable content from this source alone). No
  // archiveSha256 is passed here, so unlike import-archive, an interrupted
  // Autopsy-case import is not resumable -- re-running it creates a fresh
  // dataset rather than continuing the last one, an accepted v1 gap.
  ipcMain.handle('import-autopsy-case', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select an Autopsy case folder (the one containing the .aut file)',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const caseDir = result.filePaths[0];
    const label = path.basename(caseDir);

    appendEvent(db, {
      eventType: 'dataset_import_started',
      subjectRef: caseDir,
      payload: { originalPath: caseDir, label, sourceType: 'autopsy-case' },
    });

    const importResult = await importAutopsyCase({ caseDir });
    const inserted = insertImportResult(db, importResult, {
      sourceType: 'autopsy-case',
      originalPath: caseDir,
      label,
    });

    appendEvent(db, {
      eventType: 'dataset_import_completed',
      subjectRef: String(inserted.datasetId),
      payload: {
        datasetId: inserted.datasetId,
        insertedCount: inserted.insertedCount,
        insertFailureCount: inserted.insertFailures.length,
        parseSummary: importResult.summary,
      },
    });

    await runExtraction(db, { datasetIds: [inserted.datasetId] });
    runScan(db, { datasetIds: [inserted.datasetId] });
    persistThreads(db);

    return {
      datasetId: inserted.datasetId,
      label,
      parseSummary: importResult.summary,
      insertedCount: inserted.insertedCount,
    };
  });

  ipcMain.handle('get-available-langs', () => ({ available: AVAILABLE_LANGS, defaultLangs: DEFAULT_LANGS }));

  // options: { datasetIds?, force?, langs? } -- langs lets the
  // investigator pick which Tesseract languages to OCR this run against
  // (see ocr.js's AVAILABLE_LANGS) instead of always using the eng+fas
  // default, e.g. re-running a dataset once it's clear its images are in
  // Arabic rather than Farsi.
  ipcMain.handle('run-extraction', (_event, options) => runExtraction(db, options ?? {}));

  ipcMain.handle('get-available-translate-langs', () => ({ available: AVAILABLE_TRANSLATE_LANGS }));

  // On-demand only, one item at a time -- unlike OCR, translation has no
  // way to auto-detect a source language (no language-ID model exists in
  // this codebase), so it can never run automatically at import time; the
  // investigator picks a language explicitly per message/attachment (see
  // src/translate/translate-record.js).
  ipcMain.handle('translate-communication', (_event, { communicationId, sourceLang }) =>
    translateCommunication(db, communicationId, sourceLang)
  );
  ipcMain.handle('translate-attachment', (_event, { attachmentId, sourceLang }) =>
    translateAttachment(db, attachmentId, sourceLang)
  );

  ipcMain.handle('run-scan', (_event, datasetIds) => runScan(db, { datasetIds }));

  ipcMain.handle('run-search', (_event, { datasetIds, query }) => runSearch(db, { datasetIds, query }));

  // Deliberately never copies the attachment's original bytes out of the
  // app -- only the already-extracted/OCR'd text. Raw-file export was
  // removed on request: the user judged handing back a still-live,
  // potentially malware-laden original file too much liability for a
  // non-forensic-background investigator to take on personally.
  ipcMain.handle('export-attachment', async (_event, attachmentId) => {
    const row = db
      .prepare('SELECT filename, extractedText, extractionStatus, contentHash FROM attachments WHERE id = ?')
      .get(attachmentId);
    if (!row || row.extractionStatus !== 'attempted_succeeded' || !row.extractedText) {
      throw new Error('No extracted text is available for this attachment. Raw-file export is disabled.');
    }

    const baseName = (row.filename || 'attachment').replace(/\.[^./\\]+$/, '');
    const result = await dialog.showSaveDialog({
      title: 'Export extracted text',
      defaultPath: `${baseName}.extracted.txt`,
    });
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, row.extractedText, 'utf8');

    appendEvent(db, {
      eventType: 'export_created',
      subjectRef: String(attachmentId),
      payload: { attachmentId, filename: row.filename, contentHash: row.contentHash, exportedTo: result.filePath, exportKind: 'extracted_text' },
    });

    return result.filePath;
  });

  ipcMain.handle('focus-add', (_event, { communicationIds, addedVia, sourceNote }) =>
    addToFocusSet(db, communicationIds, { addedVia, sourceNote })
  );

  ipcMain.handle('focus-remove', (_event, communicationIds) => removeFromFocusSet(db, communicationIds));

  ipcMain.handle('focus-clear', () => clearFocusSet(db));

  ipcMain.handle('focus-list', () => listFocusSet(db));

  ipcMain.handle('focus-materialize', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder to export the focus set into',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    return materializeFocusSet(db, result.filePaths[0]);
  });

  ipcMain.handle('delete-dataset', async (event, datasetId) => {
    const dataset = db.prepare('SELECT label, originalPath FROM datasets WHERE id = ?').get(datasetId);
    if (!dataset) return { deleted: false };

    const win = BrowserWindow.fromWebContents(event.sender);
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete dataset',
      message: `Delete "${dataset.label || dataset.originalPath}"?`,
      detail: 'This removes every message, attachment, and flagged term imported from this dataset. This cannot be undone.',
    });
    if (confirmation.response !== 1) return { deleted: false, cancelled: true };

    return deleteDataset(db, datasetId);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(here, '..', 'dist', 'renderer', 'index.html'));
  }
}

app.whenReady().then(async () => {
  const workspaceDir = await resolveWorkspaceDir(app.getPath('userData'));
  initStorage(workspaceDir);
  registerWorkspaceMenu();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) db.close();
});
