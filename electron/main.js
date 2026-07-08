import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { listDatasets, listCommunications, getCommunication as dbGetCommunication, getCryptoMatches } from '../src/db/query.js';
import { getThreadsForDatasets } from '../src/db/thread-query.js';
import { deleteDataset } from '../src/db/delete-dataset.js';
import { importArchive } from '../src/parser/index.js';
import { runExtraction } from '../src/extract/run-extraction.js';
import { runScan } from '../src/crypto-detect/run-scan.js';
import { runSearch } from '../src/search/run-search.js';
import { hashFileStreaming } from '../src/parser/hash.js';
import { appendEvent } from '../src/audit/audit-log.js';
import { addToFocusSet, removeFromFocusSet, clearFocusSet, listFocusSet } from '../src/db/focus-set.js';
import { materializeFocusSet } from '../src/db/materialize.js';
import { persistThreads } from '../src/threading/persist-threads.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Read once at startup, not per-request -- package.json never changes
// while the app is running. Surfaced to the renderer via get-app-info so
// the running build number is visible in the UI, matching the same
// buildNumber baked into the packaged exe's Windows file-version resource
// (see scripts/bump-build-number.mjs).
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

let db;
let attachmentsRootDir;

function initStorage() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'communications.db');
  attachmentsRootDir = path.join(userData, 'attachments');
  // src/extract/ocr.js's traineddata cache must live outside the
  // (read-only, once packaged) app directory -- see its own comment.
  process.env.TESSDATA_CACHE_DIR = path.join(userData, 'tessdata-cache');
  db = openDatabase(dbPath);
  appendEvent(db, {
    eventType: 'app_launch',
    payload: { version: pkg.version, buildNumber: pkg.buildNumber, buildVersion: pkg.build?.buildVersion },
  });
}

function registerIpcHandlers() {
  ipcMain.handle('get-app-info', () => ({
    version: pkg.version,
    buildNumber: pkg.buildNumber,
    buildVersion: pkg.build?.buildVersion,
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

  ipcMain.handle('run-extraction', (_event, datasetIds) => runExtraction(db, { datasetIds }));

  ipcMain.handle('run-scan', (_event, datasetIds) => runScan(db, { datasetIds }));

  ipcMain.handle('run-search', (_event, { datasetIds, query }) => runSearch(db, { datasetIds, query }));

  ipcMain.handle('export-attachment', async (_event, attachmentId) => {
    const row = db.prepare('SELECT filename, savedPath, contentHash FROM attachments WHERE id = ?').get(attachmentId);
    if (!row || !row.savedPath) {
      throw new Error('This attachment has no saved file to export.');
    }

    const result = await dialog.showSaveDialog({
      title: 'Export attachment',
      defaultPath: row.filename || 'attachment',
    });
    if (result.canceled || !result.filePath) return null;

    await fs.copyFile(row.savedPath, result.filePath);

    appendEvent(db, {
      eventType: 'export_created',
      subjectRef: String(attachmentId),
      payload: { attachmentId, filename: row.filename, contentHash: row.contentHash, exportedTo: result.filePath },
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

app.whenReady().then(() => {
  initStorage();
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
