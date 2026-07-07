// contextIsolation stays on, nodeIntegration stays off -- the renderer
// never touches Node/the filesystem/the database directly. Every call
// here is a thin pass-through to an ipcMain.handle() in electron/main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDatasets: () => ipcRenderer.invoke('list-datasets'),
  listThreads: (datasetIds) => ipcRenderer.invoke('list-threads', datasetIds),
  getCommunication: (id) => ipcRenderer.invoke('get-communication', id),
  getCryptoMatches: (datasetIds) => ipcRenderer.invoke('get-crypto-matches', datasetIds),
  importArchive: () => ipcRenderer.invoke('import-archive'),
  runExtraction: (datasetIds) => ipcRenderer.invoke('run-extraction', datasetIds),
  runScan: (datasetIds) => ipcRenderer.invoke('run-scan', datasetIds),
  exportAttachment: (attachmentId) => ipcRenderer.invoke('export-attachment', attachmentId),
  deleteDataset: (datasetId) => ipcRenderer.invoke('delete-dataset', datasetId),
});
