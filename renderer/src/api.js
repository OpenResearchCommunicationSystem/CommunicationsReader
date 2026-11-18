// Single seam between the UI and the outside world. When running inside
// Electron, window.api is exposed by electron/preload.cjs via
// contextBridge and every call here goes over real IPC to the main
// process (which owns src/db, src/parser, etc. -- the renderer never
// touches Node/the filesystem/the database directly, per contextIsolation
// hygiene). When running standalone in a browser (`npm run dev:renderer`
// with no Electron), window.api is undefined and these fall back to
// mock data so the UI can be built/previewed without the full app.
import {
  mockDatasets,
  mockThreads,
  mockGetCommunication,
  mockCryptoMatches,
  mockRunSearch,
  mockFocusAdd,
  mockFocusRemove,
  mockFocusClear,
  mockFocusList,
  mockFocusMaterialize,
  mockFocusExportText,
  mockFindAttachmentsByHash,
} from './mockData.js';

const hasRealApi = typeof window !== 'undefined' && window.api;

export async function getAppInfo() {
  if (hasRealApi) return window.api.getAppInfo();
  return { version: 'dev', buildNumber: 'dev', buildVersion: 'dev' };
}

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

export async function importAutopsyCase() {
  if (hasRealApi) return window.api.importAutopsyCase();
  throw new Error('importAutopsyCase is only available inside the Electron app');
}

export async function imageToText(attachmentId) {
  if (hasRealApi) return window.api.imageToText(attachmentId);
  throw new Error('imageToText is only available inside the Electron app');
}

// Mirrors src/translate/translate.js's AVAILABLE_LANGS for preview mode.
// Deliberately excludes 'ell' (Greek) -- see that module's comment on why
// it's not shipped yet, not just omitted from this mock by oversight.
const MOCK_AVAILABLE_TRANSLATE_LANGS = {
  ara: 'Arabic',
  chi_sim: 'Chinese (Simplified)',
  rus: 'Russian',
  tur: 'Turkish',
  fas: 'Farsi',
};

export async function getAvailableTranslateLangs() {
  if (hasRealApi) return window.api.getAvailableTranslateLangs();
  return { available: MOCK_AVAILABLE_TRANSLATE_LANGS };
}

export async function translateCommunication(communicationId, sourceLang) {
  if (hasRealApi) return window.api.translateCommunication(communicationId, sourceLang);
  throw new Error('translateCommunication is only available inside the Electron app');
}

export async function translateAttachment(attachmentId, sourceLang) {
  if (hasRealApi) return window.api.translateAttachment(attachmentId, sourceLang);
  throw new Error('translateAttachment is only available inside the Electron app');
}

export async function getAiConfigStatus() {
  if (hasRealApi) return window.api.getAiConfigStatus();
  return { configured: false, provider: '', baseUrl: '', model: '', orgId: '' };
}

export async function saveAiConfig(config) {
  if (hasRealApi) return window.api.saveAiConfig(config);
  throw new Error('saveAiConfig is only available inside the Electron app');
}

export async function previewFocusSelection(communicationIds) {
  if (hasRealApi) return window.api.previewFocusSelection(communicationIds);
  throw new Error('previewFocusSelection is only available inside the Electron app');
}

export async function translateFocusSelection(communicationIds, sourceLang) {
  if (hasRealApi) return window.api.translateFocusSelection(communicationIds, sourceLang);
  throw new Error('translateFocusSelection is only available inside the Electron app');
}

export async function analyzeThread(threadId, communicationIds) {
  if (hasRealApi) return window.api.analyzeThread(threadId, communicationIds);
  throw new Error('analyzeThread is only available inside the Electron app');
}

export async function getThreadSummary(threadId) {
  if (hasRealApi) return window.api.getThreadSummary(threadId);
  return null;
}

export async function runScan(datasetIds) {
  if (hasRealApi) return window.api.runScan(datasetIds);
  throw new Error('runScan is only available inside the Electron app');
}

export async function runSearch(options) {
  if (hasRealApi) return window.api.runSearch(options);
  return mockRunSearch(options);
}

export async function exportAttachment(attachmentId) {
  if (hasRealApi) return window.api.exportAttachment(attachmentId);
  throw new Error('exportAttachment is only available inside the Electron app');
}

export async function deleteDataset(datasetId) {
  if (hasRealApi) return window.api.deleteDataset(datasetId);
  throw new Error('deleteDataset is only available inside the Electron app');
}

export async function focusAdd(communicationIds, addedVia, sourceNote) {
  if (hasRealApi) return window.api.focusAdd(communicationIds, addedVia, sourceNote);
  return mockFocusAdd(communicationIds);
}

export async function focusRemove(communicationIds) {
  if (hasRealApi) return window.api.focusRemove(communicationIds);
  return mockFocusRemove(communicationIds);
}

export async function focusClear() {
  if (hasRealApi) return window.api.focusClear();
  return mockFocusClear();
}

export async function focusList() {
  if (hasRealApi) return window.api.focusList();
  return mockFocusList();
}

export async function focusMaterialize() {
  if (hasRealApi) return window.api.focusMaterialize();
  return mockFocusMaterialize();
}

export async function focusExportText(format) {
  if (hasRealApi) return window.api.focusExportText(format);
  return mockFocusExportText();
}

export async function findByHash(hash) {
  if (hasRealApi) return window.api.findByHash(hash);
  return mockFindAttachmentsByHash(hash);
}

export const isElectron = hasRealApi;
