import { useEffect, useMemo, useState } from 'react';
import DatasetPanel from './components/DatasetPanel.jsx';
import ThreadList from './components/ThreadList.jsx';
import MessageList from './components/MessageList.jsx';
import ReadingPane from './components/ReadingPane.jsx';
import * as api from './api.js';

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [selectedCommunicationId, setSelectedCommunicationId] = useState(null);
  const [communication, setCommunication] = useState(null);
  const [cryptoMatches, setCryptoMatches] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.listThreads(selectedDatasetIds).then(setThreads).catch((err) => setError(err.message));
    api.getCryptoMatches(selectedDatasetIds).then(setCryptoMatches).catch(() => {});
    setSelectedThreadId(null);
    setSelectedCommunicationId(null);
    setCommunication(null);
  }, [selectedDatasetIds]);

  useEffect(() => {
    if (selectedCommunicationId == null) {
      setCommunication(null);
      return;
    }
    api.getCommunication(selectedCommunicationId).then(setCommunication).catch((err) => setError(err.message));
  }, [selectedCommunicationId]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.threadId === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  function toggleDataset(id) {
    setSelectedDatasetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllDatasets() {
    setSelectedDatasetIds([]);
  }

  function selectThread(threadId) {
    setSelectedThreadId(threadId);
    setSelectedCommunicationId(null);
  }

  async function handleImportClick() {
    try {
      const result = await api.importArchive();
      if (result) {
        api.listDatasets().then(setDatasets);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportAttachment(attachmentId) {
    try {
      await api.exportAttachment(attachmentId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteDataset(datasetId) {
    try {
      const result = await api.deleteDataset(datasetId);
      if (result?.deleted) {
        setSelectedDatasetIds((prev) => prev.filter((id) => id !== datasetId));
        api.listDatasets().then(setDatasets);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-titlebar">
        <span className="app-title">Communications Reader</span>
        {!api.isElectron && <span className="preview-badge">Preview mode (mock data)</span>}
      </header>
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error} <span className="dismiss">(click to dismiss)</span>
        </div>
      )}
      <div className="app-body">
        <DatasetPanel
          datasets={datasets}
          selectedIds={selectedDatasetIds}
          onToggle={toggleDataset}
          onSelectAll={selectAllDatasets}
          onImportClick={handleImportClick}
          onDelete={handleDeleteDataset}
        />
        <ThreadList threads={threads} selectedThreadId={selectedThreadId} onSelect={selectThread} />
        <MessageList thread={selectedThread} selectedCommunicationId={selectedCommunicationId} onSelect={setSelectedCommunicationId} />
        <ReadingPane communication={communication} cryptoMatches={cryptoMatches} onExportAttachment={handleExportAttachment} />
      </div>
    </div>
  );
}
