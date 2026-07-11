import { useEffect, useMemo, useState } from 'react';
import DatasetPanel from './components/DatasetPanel.jsx';
import ThreadList from './components/ThreadList.jsx';
import MessageList from './components/MessageList.jsx';
import ReadingPane from './components/ReadingPane.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import FocusPanel from './components/FocusPanel.jsx';
import ResizeHandle from './components/ResizeHandle.jsx';
import ActivityIndicator from './components/ActivityIndicator.jsx';
import * as api from './api.js';

const LAYOUT_STORAGE_KEY = 'panelLayout.v1';
const COLLAPSED_WIDTH = 40;
const MIN_PANEL_WIDTH = 140;
const MAX_PANEL_WIDTH = 640;
const DEFAULT_LAYOUT = {
  dataset: { width: 220, collapsed: false },
  threads: { width: 300, collapsed: false },
  messages: { width: 320, collapsed: false },
  focus: { width: 260, collapsed: false },
};

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    // Merge over defaults rather than trusting the stored blob outright --
    // a future panel added to the layout shouldn't come back undefined for
    // users with an older saved layout.
    const merged = { ...DEFAULT_LAYOUT };
    for (const key of Object.keys(DEFAULT_LAYOUT)) {
      if (parsed[key]) merged[key] = { ...DEFAULT_LAYOUT[key], ...parsed[key] };
    }
    return merged;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function clampWidth(width) {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

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
  const [availableLangs, setAvailableLangs] = useState(null);
  const [selectedLangs, setSelectedLangs] = useState([]);
  const [reExtractingId, setReExtractingId] = useState(null);
  const [reExtractStatus, setReExtractStatus] = useState({});
  const [availableTranslateLangs, setAvailableTranslateLangs] = useState(null);
  const [translatingCommunication, setTranslatingCommunication] = useState(false);
  const [translatingAttachmentId, setTranslatingAttachmentId] = useState(null);
  const [layout, setLayout] = useState(loadLayout);
  // Covers the operations that previously had zero loading feedback at all
  // (import-archive, import-autopsy-case, delete-dataset) -- unlike
  // re-extract/translate/materialize below, these can run for a long time
  // against a real multi-GB dataset with nothing on screen telling the
  // investigator whether the app is working or just hung.
  const [activeImportKind, setActiveImportKind] = useState(null); // 'archive' | 'autopsy' | 'delete' | null

  // Single unified "is anything running right now" signal for the titlebar
  // indicator, folding together every long-running operation's own state
  // (each of which also still drives its own inline "Running…" label at
  // the point of interaction) so there's one place to glance at regardless
  // of which action is in flight.
  const activeOperation = useMemo(() => {
    if (activeImportKind === 'archive') return 'Importing archive…';
    if (activeImportKind === 'autopsy') return 'Importing Autopsy case…';
    if (activeImportKind === 'delete') return 'Deleting dataset…';
    if (materializing) return 'Preparing focus export…';
    if (translatingCommunication) return 'Translating…';
    if (translatingAttachmentId != null) return 'Translating attachment…';
    if (reExtractingId != null) return 'Re-running OCR…';
    return null;
  }, [activeImportKind, materializing, translatingCommunication, translatingAttachmentId, reExtractingId]);

  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  function toggleCollapse(key) {
    setLayout((prev) => ({ ...prev, [key]: { ...prev[key], collapsed: !prev[key].collapsed } }));
  }

  // invert=true for the one handle (reading pane <-> focus) where dragging
  // right should shrink the panel, since it sits to the handle's right
  // instead of its left.
  function resizeColumn(key, delta, invert = false) {
    setLayout((prev) => {
      if (prev[key].collapsed) return prev;
      const signedDelta = invert ? -delta : delta;
      return { ...prev, [key]: { ...prev[key], width: clampWidth(prev[key].width + signedDelta) } };
    });
  }

  function colStyle(key) {
    const col = layout[key];
    const width = col.collapsed ? COLLAPSED_WIDTH : col.width;
    return { flex: `0 0 ${width}px` };
  }

  function loadFocusSet() {
    return api.focusList().then(setFocusSet).catch((err) => setError(err.message));
  }

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch((err) => setError(err.message));
    api.getAppInfo().then(setAppInfo).catch(() => {});
    api
      .getAvailableLangs()
      .then(({ available, defaultLangs }) => {
        setAvailableLangs(available);
        setSelectedLangs(defaultLangs);
      })
      .catch(() => {});
    api
      .getAvailableTranslateLangs()
      .then(({ available }) => setAvailableTranslateLangs(available))
      .catch(() => {});
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
    setActiveImportKind('archive');
    try {
      const result = await api.importArchive();
      if (result) {
        api.listDatasets().then(setDatasets);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActiveImportKind(null);
    }
  }

  async function handleImportAutopsyCaseClick() {
    setActiveImportKind('autopsy');
    try {
      const result = await api.importAutopsyCase();
      if (result) {
        api.listDatasets().then(setDatasets);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActiveImportKind(null);
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
    setActiveImportKind('delete');
    try {
      const result = await api.deleteDataset(datasetId);
      if (result?.deleted) {
        setSelectedDatasetIds((prev) => prev.filter((id) => id !== datasetId));
        api.listDatasets().then(setDatasets);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActiveImportKind(null);
    }
  }

  function toggleLang(code) {
    setSelectedLangs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleReExtract(datasetId) {
    setReExtractingId(datasetId);
    setReExtractStatus((prev) => ({ ...prev, [datasetId]: null }));
    try {
      const result = await api.runExtraction({ datasetIds: [datasetId], langs: selectedLangs, force: true });
      setReExtractStatus((prev) => ({ ...prev, [datasetId]: result }));
    } catch (err) {
      setReExtractStatus((prev) => ({ ...prev, [datasetId]: { error: err.message } }));
    } finally {
      setReExtractingId(null);
    }
  }

  async function handleTranslateCommunication(communicationId, sourceLang) {
    setTranslatingCommunication(true);
    try {
      await api.translateCommunication(communicationId, sourceLang);
      // Re-fetch rather than patch local state -- the same "trust the DB,
      // not an optimistic guess" approach every other mutating action here
      // already takes (see handleDeleteDataset/handleReExtract).
      const refreshed = await api.getCommunication(communicationId);
      setCommunication(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslatingCommunication(false);
    }
  }

  async function handleTranslateAttachment(attachmentId, sourceLang) {
    setTranslatingAttachmentId(attachmentId);
    try {
      await api.translateAttachment(attachmentId, sourceLang);
      const refreshed = await api.getCommunication(selectedCommunicationId);
      setCommunication(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslatingAttachmentId(null);
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
            {appInfo.workspaceDir && <> &mdash; {appInfo.workspaceDir}</>}
          </span>
        )}
        {!api.isElectron && <span className="preview-badge">Preview mode (mock data)</span>}
        <ActivityIndicator label={activeOperation} />
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
          onImportAutopsyCaseClick={handleImportAutopsyCaseClick}
          onDelete={handleDeleteDataset}
          activeImportKind={activeImportKind}
          availableLangs={availableLangs}
          selectedLangs={selectedLangs}
          onToggleLang={toggleLang}
          onReExtract={handleReExtract}
          reExtractingId={reExtractingId}
          reExtractStatus={reExtractStatus}
          style={colStyle('dataset')}
          collapsed={layout.dataset.collapsed}
          onToggleCollapse={() => toggleCollapse('dataset')}
        />
        <ResizeHandle onResize={(delta) => resizeColumn('dataset', delta)} />
        <ThreadList
          threads={visibleThreads}
          selectedThreadId={selectedThreadId}
          onSelect={selectThread}
          onAddThreadToFocus={handleAddThreadToFocus}
          style={colStyle('threads')}
          collapsed={layout.threads.collapsed}
          onToggleCollapse={() => toggleCollapse('threads')}
        />
        <ResizeHandle onResize={(delta) => resizeColumn('threads', delta)} />
        <MessageList
          thread={selectedThread}
          selectedCommunicationId={selectedCommunicationId}
          onSelect={setSelectedCommunicationId}
          matchedIds={matchedCommunicationIds}
          focusedIds={focusedIds}
          onAddToFocus={handleAddToFocus}
          style={colStyle('messages')}
          collapsed={layout.messages.collapsed}
          onToggleCollapse={() => toggleCollapse('messages')}
        />
        <ResizeHandle onResize={(delta) => resizeColumn('messages', delta)} />
        <ReadingPane
          key={communication?.id}
          communication={communication}
          cryptoMatches={cryptoMatches}
          onExportAttachment={handleExportAttachment}
          availableTranslateLangs={availableTranslateLangs}
          onTranslateCommunication={handleTranslateCommunication}
          onTranslateAttachment={handleTranslateAttachment}
          translatingCommunication={translatingCommunication}
          translatingAttachmentId={translatingAttachmentId}
        />
        <ResizeHandle onResize={(delta) => resizeColumn('focus', delta, true)} />
        <FocusPanel
          focusSet={focusSet}
          selectedCommunicationId={selectedCommunicationId}
          onSelect={setSelectedCommunicationId}
          onRemove={handleRemoveFromFocus}
          onClear={handleClearFocus}
          onMaterialize={handleMaterializeFocus}
          materializing={materializing}
          materializeStatus={materializeStatus}
          style={colStyle('focus')}
          collapsed={layout.focus.collapsed}
          onToggleCollapse={() => toggleCollapse('focus')}
        />
      </div>
    </div>
  );
}
