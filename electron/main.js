import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../src/db/schema.js';
import { insertImportResult } from '../src/db/insert.js';
import { listDatasets, listCommunications, getCommunication as dbGetCommunication, getCryptoMatches } from '../src/db/query.js';
import { getThreadsForDatasets } from '../src/db/thread-query.js';
import { deleteDataset } from '../src/db/delete-dataset.js';
import { importArchive } from '../src/parser/index.js';
import { runExtraction } from '../src/extract/run-extraction.js';
import { runScan } from '../src/crypto-detect/run-scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));

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
}

function registerIpcHandlers() {
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

    const importResult = await importArchive({ zipPath, outputAttachmentsDir });
    const sourceType = importResult.containerType === 'mbox' ? 'email-mbox' : 'email-eml';
    const inserted = insertImportResult(db, importResult, {
      sourceType,
      originalPath: zipPath,
      label,
      attachmentsDir: outputAttachmentsDir,
    });

    // Extraction and crypto scanning run immediately after import so the
    // investigator doesn't need a separate step -- both are re-runnable
    // later (e.g. after a keyword-list update) via the same functions.
    await runExtraction(db, { datasetIds: [inserted.datasetId] });
    runScan(db, { datasetIds: [inserted.datasetId] });

    return {
      datasetId: inserted.datasetId,
      label,
      parseSummary: importResult.summary,
      insertedCount: inserted.insertedCount,
    };
  });

  ipcMain.handle('run-extraction', (_event, datasetIds) => runExtraction(db, { datasetIds }));

  ipcMain.handle('run-scan', (_event, datasetIds) => runScan(db, { datasetIds }));

  ipcMain.handle('export-attachment', async (_event, attachmentId) => {
    const row = db.prepare('SELECT filename, savedPath FROM attachments WHERE id = ?').get(attachmentId);
    if (!row || !row.savedPath) {
      throw new Error('This attachment has no saved file to export.');
    }

    const result = await dialog.showSaveDialog({
      title: 'Export attachment',
      defaultPath: row.filename || 'attachment',
    });
    if (result.canceled || !result.filePath) return null;

    await fs.copyFile(row.savedPath, result.filePath);
    return result.filePath;
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
