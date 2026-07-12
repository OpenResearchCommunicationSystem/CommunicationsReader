// contextIsolation stays on, nodeIntegration stays off -- the renderer
// never touches Node/the filesystem/the database directly. Every call
// here is a thin pass-through to an ipcMain.handle() in electron/main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  listDatasets: () => ipcRenderer.invoke('list-datasets'),
  listThreads: (datasetIds) => ipcRenderer.invoke('list-threads', datasetIds),
  getCommunication: (id) => ipcRenderer.invoke('get-communication', id),
  getCryptoMatches: (datasetIds) => ipcRenderer.invoke('get-crypto-matches', datasetIds),
  importArchive: () => ipcRenderer.invoke('import-archive'),
  importAutopsyCase: () => ipcRenderer.invoke('import-autopsy-case'),
  getAvailableLangs: () => ipcRenderer.invoke('get-available-langs'),
  runExtraction: (options) => ipcRenderer.invoke('run-extraction', options),
  getAvailableTranslateLangs: () => ipcRenderer.invoke('get-available-translate-langs'),
  translateCommunication: (communicationId, sourceLang) => ipcRenderer.invoke('translate-communication', { communicationId, sourceLang }),
  translateAttachment: (attachmentId, sourceLang) => ipcRenderer.invoke('translate-attachment', { attachmentId, sourceLang }),
  runScan: (datasetIds) => ipcRenderer.invoke('run-scan', datasetIds),
  runSearch: (options) => ipcRenderer.invoke('run-search', options),
  exportAttachment: (attachmentId) => ipcRenderer.invoke('export-attachment', attachmentId),
  deleteDataset: (datasetId) => ipcRenderer.invoke('delete-dataset', datasetId),
  focusAdd: (communicationIds, addedVia, sourceNote) => ipcRenderer.invoke('focus-add', { communicationIds, addedVia, sourceNote }),
  focusRemove: (communicationIds) => ipcRenderer.invoke('focus-remove', communicationIds),
  focusClear: () => ipcRenderer.invoke('focus-clear'),
  focusList: () => ipcRenderer.invoke('focus-list'),
  focusMaterialize: () => ipcRenderer.invoke('focus-materialize'),
  focusExportText: (format) => ipcRenderer.invoke('focus-export-text', format),
  findByHash: (hash) => ipcRenderer.invoke('find-by-hash', hash),
});
