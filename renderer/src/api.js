// Single seam between the UI and the outside world. When running inside
// Electron, window.api is exposed by electron/preload.cjs via
// contextBridge and every call here goes over real IPC to the main
// process (which owns src/db, src/parser, etc. -- the renderer never
// touches Node/the filesystem/the database directly, per contextIsolation
// hygiene). When running standalone in a browser (`npm run dev:renderer`
// with no Electron), window.api is undefined and these fall back to
// mock data so the UI can be built/previewed without the full app.
import { mockDatasets, mockThreads, mockGetCommunication, mockCryptoMatches } from './mockData.js';

const hasRealApi = typeof window !== 'undefined' && window.api;

export async function listDatasets() {
  if (hasRealApi) return window.api.listDatasets();
  return mockDatasets;
}

export async function listThreads(datasetIds) {
  if (hasRealApi) return window.api.listThreads(datasetIds);
  return mockThreads;
}

export async function getCommunication(id) {
  if (hasRealApi) return window.api.getCommunication(id);
  return mockGetCommunication(id);
}

export async function getCryptoMatches(datasetIds) {
  if (hasRealApi) return window.api.getCryptoMatches(datasetIds);
  return mockCryptoMatches;
}

export async function importArchive() {
  if (hasRealApi) return window.api.importArchive();
  throw new Error('importArchive is only available inside the Electron app');
}

export async function runExtraction(datasetIds) {
  if (hasRealApi) return window.api.runExtraction(datasetIds);
  throw new Error('runExtraction is only available inside the Electron app');
}

export async function runScan(datasetIds) {
  if (hasRealApi) return window.api.runScan(datasetIds);
  throw new Error('runScan is only available inside the Electron app');
}

export async function exportAttachment(attachmentId) {
  if (hasRealApi) return window.api.exportAttachment(attachmentId);
  throw new Error('exportAttachment is only available inside the Electron app');
}

export async function deleteDataset(datasetId) {
  if (hasRealApi) return window.api.deleteDataset(datasetId);
  throw new Error('deleteDataset is only available inside the Electron app');
}

export const isElectron = hasRealApi;
