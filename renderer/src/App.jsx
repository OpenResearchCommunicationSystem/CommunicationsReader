import { useEffect, useMemo, useState } from 'react';
import DatasetPanel from './components/DatasetPanel.jsx';
import ThreadList from './components/ThreadList.jsx';
import MessageList from './components/MessageList.jsx';
import ReadingPane from './components/ReadingPane.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import FocusPanel from './components/FocusPanel.jsx';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [focusSet, setFocusSet] = useState([]);
  const [materializing, setMaterializing] = useState(false);
  const [materializeStatus, setMaterializeStatus] = useState(null);

  function loadFocusSet() {
    return api.focusList().then(setFocusSet).catch((err) => setError(err.message));
  }

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch((err) => setError(err.message));
    api.getAppInfo().then(setAppInfo).catch(() => {});
    loadFocusSet();
  }, []);

  useEffect(() => {
    api.listThreads(selectedDatasetIds).then(setThreads).catch((err) => setError(err.message));
    api.getCryptoMatches(selectedDatasetIds).then(setCryptoMatches).catch(() => {});
    setSelectedThreadId(null);
    setSelectedCommunicationId(null);
    setCommunication(null);
    // A search result set is scoped to whatever datasets it was run
    // against -- changing the dataset selection invalidates it rather
    // than leaving a stale/mis-scoped filter applied.
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
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

  // null means "no active search" (show everything, unfiltered).
  const matchedCommunicationIds = useMemo(
    () => (searchResults ? new Set(searchResults.map((r) => r.communicationId)) : null),
    [searchResults]
  );

  // Narrow the thread list to threads containing at least one matching
  // message. The message list within an opened thread is NOT filtered
  // the same way -- see MessageList's matchedIds prop below -- since
  // hiding the non-matching messages around a hit would remove useful
  // conversational context for an investigator.
  const visibleThreads = useMemo(() => {
    if (!matchedCommunicationIds) return threads;
    return threads.filter((t) => t.members.some((m) => matchedCommunicationIds.has(m.communicationId)));
  }, [threads, matchedCommunicationIds]);

  const focusedIds = useMemo(() => new Set(focusSet.map((c) => c.id)), [focusSet]);

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

  async function handleAddToFocus(communicationId) {
    try {
      await api.focusAdd([communicationId], 'manual');
      await loadFocusSet();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddThreadToFocus(thread) {
    try {
      await api.focusAdd(thread.members.map((m) => m.communicationId), 'thread_expand', thread.subject);
      await loadFocusSet();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveFromFocus(communicationId) {
    try {
      await api.focusRemove([communicationId]);
      await loadFocusSet();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleClearFocus() {
    try {
      await api.focusClear();
      await loadFocusSet();
      setMaterializeStatus(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMaterializeFocus() {
    setMaterializing(true);
    setMaterializeStatus(null);
    try {
      const result = await api.focusMaterialize();
      setMaterializeStatus(result); // null (dialog cancelled) clears any prior status
    } catch (err) {
      setMaterializeStatus({ error: err.message });
    } finally {
      setMaterializing(false);
    }
  }

  async function handleSearch(query) {
    setSearchQuery(query);
    if (!query || !query.trim()) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    try {
      const result = await api.runSearch({ datasetIds: selectedDatasetIds, query });
      if (result.error) {
        setSearchError(result.error);
        setSearchResults(null);
      } else {
        setSearchError(null);
        setSearchResults(result.results);
      }
    } catch (err) {
      setSearchError(err.message);
      setSearchResults(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-titlebar">
        <span className="app-title">Communications Reader</span>
        {appInfo && (
          <span className="app-build-info">
            v{appInfo.version} (build {appInfo.buildNumber})
          </span>
        )}
        {!api.isElectron && <span className="preview-badge">Preview mode (mock data)</span>}
      </header>
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error} <span className="dismiss">(click to dismiss)</span>
        </div>
      )}
      <SearchPanel
        onSearch={handleSearch}
        resultCount={searchResults ? searchResults.length : 0}
        error={searchError}
        hasActiveQuery={Boolean(searchQuery && searchQuery.trim())}
      />
      <div className="app-body">
        <DatasetPanel
          datasets={datasets}
          selectedIds={selectedDatasetIds}
          onToggle={toggleDataset}
          onSelectAll={selectAllDatasets}
          onImportClick={handleImportClick}
          onDelete={handleDeleteDataset}
        />
        <ThreadList
          threads={visibleThreads}
          selectedThreadId={selectedThreadId}
          onSelect={selectThread}
          onAddThreadToFocus={handleAddThreadToFocus}
        />
        <MessageList
          thread={selectedThread}
          selectedCommunicationId={selectedCommunicationId}
          onSelect={setSelectedCommunicationId}
          matchedIds={matchedCommunicationIds}
          focusedIds={focusedIds}
          onAddToFocus={handleAddToFocus}
        />
        <ReadingPane communication={communication} cryptoMatches={cryptoMatches} onExportAttachment={handleExportAttachment} />
        <FocusPanel
          focusSet={focusSet}
          selectedCommunicationId={selectedCommunicationId}
          onSelect={setSelectedCommunicationId}
          onRemove={handleRemoveFromFocus}
          onClear={handleClearFocus}
          onMaterialize={handleMaterializeFocus}
          materializing={materializing}
          materializeStatus={materializeStatus}
        />
      </div>
    </div>
  );
}
