import { useEffect, useMemo, useState } from 'react';
import DatasetPanel from './components/DatasetPanel.jsx';
import ThreadList from './components/ThreadList.jsx';
import MessageList from './components/MessageList.jsx';
import ReadingPane from './components/ReadingPane.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import ReferenceJump from './components/ReferenceJump.jsx';
import HashSearch from './components/HashSearch.jsx';
import FocusPanel from './components/FocusPanel.jsx';
import ResizeHandle from './components/ResizeHandle.jsx';
import ActivityIndicator from './components/ActivityIndicator.jsx';
import AiSettingsPanel from './components/AiSettingsPanel.jsx';
import CollectionAnalysisPanel from './components/CollectionAnalysisPanel.jsx';
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
  // Set by handleJumpToReference below, consumed by the effect that watches
  // `threads` -- not used for anything else, so it's fine that it's briefly
  // stale while a dataset switch it triggered is still reloading threads.
  const [jumpTarget, setJumpTarget] = useState(null);
  const [communication, setCommunication] = useState(null);
  const [cryptoMatches, setCryptoMatches] = useState([]);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [focusSet, setFocusSet] = useState([]);
  const [materializing, setMaterializing] = useState(false);
  const [materializeStatus, setMaterializeStatus] = useState(null);
  const [exportingText, setExportingText] = useState(false);
  const [exportTextStatus, setExportTextStatus] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [translatingCommunication, setTranslatingCommunication] = useState(false);
  const [translatingAttachmentId, setTranslatingAttachmentId] = useState(null);
  const [imageToTextAttachmentId, setImageToTextAttachmentId] = useState(null);
  const [threadSummary, setThreadSummary] = useState(null);
  const [analyzingThread, setAnalyzingThread] = useState(false);
  const [showCollectionAnalysis, setShowCollectionAnalysis] = useState(false);
  // Focus Set batch processing ("hand-select items, see what's pending vs
  // already done, run only the pending ones"). batchSelection is a Set,
  // not an array, so toggling one item's checkbox doesn't need to scan the
  // whole set. batchPreview is non-null only while the investigator is
  // looking at the pending/skip counts and hasn't committed yet -- set to
  // null on any selection change so a stale preview can never be confirmed
  // against a selection it no longer describes.
  const [batchSelection, setBatchSelection] = useState(() => new Set());
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
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
    if (exportingText) return 'Preparing text export…';
    if (translatingCommunication) return 'Translating…';
    if (translatingAttachmentId != null) return 'Translating attachment…';
    if (imageToTextAttachmentId != null) return 'Converting image to text…';
    if (analyzingThread) return 'Analyzing thread…';
    return null;
  }, [activeImportKind, materializing, exportingText, translatingCommunication, translatingAttachmentId, imageToTextAttachmentId, analyzingThread]);

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

  // Prunes any selected id that's no longer in the focus set (removed, or
  // the whole set was cleared) -- otherwise a stale id could sit in
  // batchSelection forever, inflating a later preview/batch-run count for
  // an item that isn't even visible anymore.
  useEffect(() => {
    setBatchSelection((prev) => {
      const liveIds = new Set(focusSet.map((c) => c.id));
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [focusSet]);

  useEffect(() => {
    api.listDatasets().then(setDatasets).catch((err) => setError(err.message));
    api.getAppInfo().then(setAppInfo).catch(() => {});
    refreshAiConfigured();
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

  // Resolves a pending jump-to-reference once `threads` actually contains
  // the target -- waits rather than acting immediately, since a jump that
  // also had to switch dataset scope (see handleJumpToReference) leaves
  // `threads` briefly stale from the dataset-change effect above, still
  // mid-reload. Every communication belongs to some thread (buildThreads
  // never drops a row, worst case a singleton), so once the right scope has
  // loaded a match is guaranteed -- no match yet just means "not loaded
  // yet", not "doesn't exist" (getCommunication already confirmed that).
  useEffect(() => {
    if (jumpTarget == null) return;
    const thread = threads.find((t) => t.members.some((m) => m.communicationId === jumpTarget));
    if (!thread) return;
    setSelectedThreadId(thread.threadId);
    setSelectedCommunicationId(jumpTarget);
    setJumpTarget(null);
  }, [threads, jumpTarget]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.threadId === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  // Loads whatever summary was already saved for this thread (if any) the
  // moment it's selected -- never calls the AI endpoint on its own, only
  // reads src/db's thread_summaries table. A fresh/re-run analysis is
  // always an explicit click (handleAnalyzeThread below).
  useEffect(() => {
    if (selectedThreadId == null) {
      setThreadSummary(null);
      return;
    }
    api.getThreadSummary(selectedThreadId).then(setThreadSummary).catch(() => setThreadSummary(null));
  }, [selectedThreadId]);

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

  // Refreshed at launch and whenever AI Settings is closed, so
  // translate/Analyze Collection controls appear immediately after
  // saving a key without needing an app restart.
  function refreshAiConfigured() {
    api.getAiConfigStatus().then((s) => setAiConfigured(s.configured)).catch(() => setAiConfigured(false));
  }

  async function handleTranslateCommunication(communicationId) {
    setTranslatingCommunication(true);
    try {
      await api.translateCommunication(communicationId);
      // Re-fetch rather than patch local state -- the same "trust the DB,
      // not an optimistic guess" approach every other mutating action here
      // already takes (see handleDeleteDataset).
      const refreshed = await api.getCommunication(communicationId);
      setCommunication(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslatingCommunication(false);
    }
  }

  async function handleTranslateAttachment(attachmentId) {
    setTranslatingAttachmentId(attachmentId);
    try {
      await api.translateAttachment(attachmentId);
      const refreshed = await api.getCommunication(selectedCommunicationId);
      setCommunication(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslatingAttachmentId(null);
    }
  }

  // One image, one explicit click -- the replacement for the old
  // dataset-wide "Re-run OCR" bulk button (removed; see src/extract/
  // attachment-image-to-text.js). A real extraction failure/rejection
  // is returned, not thrown (same contract as extractAttachmentText),
  // so it shows up inline in ReadingPane via the refreshed communication
  // rather than the top-level error banner.
  async function handleImageToText(attachmentId) {
    setImageToTextAttachmentId(attachmentId);
    try {
      await api.imageToText(attachmentId);
      const refreshed = await api.getCommunication(selectedCommunicationId);
      setCommunication(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setImageToTextAttachmentId(null);
    }
  }

  function handleToggleBatchSelection(communicationId) {
    setBatchSelection((prev) => {
      const next = new Set(prev);
      if (next.has(communicationId)) next.delete(communicationId);
      else next.add(communicationId);
      return next;
    });
    setBatchPreview(null);
    setBatchResult(null);
  }

  function handleSelectAllInFocus() {
    setBatchSelection(new Set(focusSet.map((c) => c.id)));
    setBatchPreview(null);
    setBatchResult(null);
  }

  function handleSelectNoneInFocus() {
    setBatchSelection(new Set());
    setBatchPreview(null);
    setBatchResult(null);
  }

  // Preview never reaches the AI endpoint -- it's a pure read of the
  // already-loaded translatedAt/extractedText fields, server-side only so
  // the renderer doesn't need to duplicate that skip logic. Required
  // before every batch run: the investigator confirmed directly that no
  // bulk AI action may run without seeing an exact count first.
  async function handlePreviewBatch() {
    try {
      const preview = await api.previewFocusSelection([...batchSelection]);
      setBatchPreview(preview);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleConfirmBatch() {
    setBatchProcessing(true);
    try {
      const result = await api.translateFocusSelection([...batchSelection]);
      setBatchResult(result);
      setBatchPreview(null);
      await loadFocusSet();
      // The reading pane may currently show one of the just-processed
      // items -- refresh it so its translation shows up without having to
      // click away and back.
      if (selectedCommunicationId && batchSelection.has(selectedCommunicationId)) {
        const refreshed = await api.getCommunication(selectedCommunicationId);
        setCommunication(refreshed);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBatchProcessing(false);
    }
  }

  function handleCancelBatchPreview() {
    setBatchPreview(null);
  }

  async function handleAddToFocus(communicationId) {
    try {
      await api.focusAdd([communicationId], 'manual');
      await loadFocusSet();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAnalyzeThread(thread) {
    setAnalyzingThread(true);
    try {
      const result = await api.analyzeThread(thread.threadId, thread.members.map((m) => m.communicationId));
      setThreadSummary(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzingThread(false);
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

  async function handleExportFocusText(format) {
    setExportingText(true);
    setExportTextStatus(null);
    try {
      const result = await api.focusExportText(format);
      setExportTextStatus(result); // null (dialog cancelled) clears any prior status
    } catch (err) {
      setExportTextStatus({ error: err.message });
    } finally {
      setExportingText(false);
    }
  }

  // Shared by both the Reference ID lookup and Hash ID search results
  // below -- switches to "all datasets" only when the target isn't already
  // in scope, then hands off to the jumpTarget effect above once `threads`
  // for the right scope has loaded.
  function jumpToCommunication(id, datasetId) {
    if (selectedDatasetIds.length > 0 && !selectedDatasetIds.includes(datasetId)) {
      setSelectedDatasetIds([]);
    }
    setJumpTarget(id);
  }

  // The "comm-N" Reference IDs written into every exported message (see
  // export-text.js) -- lets an investigator paste one straight back in,
  // whether it came from their own notes or from something an outside LLM
  // said about the export.
  async function handleJumpToReference(id) {
    const comm = await api.getCommunication(id).catch(() => null);
    if (!comm) return { error: `No message found with Reference ID ${id}.` };
    jumpToCommunication(comm.id, comm.datasetId);
    return null;
  }

  // Attachment Hash ID search -- deliberately separate from Message Content
  // Search (the token_index full-text search) and from Reference ID lookup
  // above. A content hash is universal, so this always searches everything
  // imported, not just the currently-selected dataset(s).
  async function handleHashSearch(hash) {
    return api.findByHash(hash);
  }

  function handleSelectHashResult(result) {
    jumpToCommunication(result.communicationId, result.datasetId);
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
        <button className="ai-settings-trigger" onClick={() => setShowAiSettings(true)} title="Configure the AI endpoint used for OCR/translation">
          AI Settings&hellip;
        </button>
      </header>
      {showAiSettings && (
        <AiSettingsPanel
          onClose={() => {
            setShowAiSettings(false);
            refreshAiConfigured();
          }}
        />
      )}
      {showCollectionAnalysis && (
        <CollectionAnalysisPanel
          focusSetIds={focusSet.map((c) => c.id)}
          onClose={() => setShowCollectionAnalysis(false)}
        />
      )}
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
      <ReferenceJump onJump={handleJumpToReference} />
      <HashSearch onSearch={handleHashSearch} onSelectResult={handleSelectHashResult} />
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
          threadSummary={threadSummary}
          analyzingThread={analyzingThread}
          onAnalyzeThread={handleAnalyzeThread}
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
          aiAvailable={aiConfigured}
          onTranslateCommunication={handleTranslateCommunication}
          onTranslateAttachment={handleTranslateAttachment}
          translatingCommunication={translatingCommunication}
          translatingAttachmentId={translatingAttachmentId}
          onImageToText={handleImageToText}
          imageToTextAttachmentId={imageToTextAttachmentId}
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
          onExportText={handleExportFocusText}
          exportingText={exportingText}
          exportTextStatus={exportTextStatus}
          aiAvailable={aiConfigured}
          onOpenCollectionAnalysis={() => setShowCollectionAnalysis(true)}
          batchSelection={batchSelection}
          onToggleBatchSelection={handleToggleBatchSelection}
          onSelectAllInFocus={handleSelectAllInFocus}
          onSelectNoneInFocus={handleSelectNoneInFocus}
          batchPreview={batchPreview}
          onPreviewBatch={handlePreviewBatch}
          onConfirmBatch={handleConfirmBatch}
          onCancelBatchPreview={handleCancelBatchPreview}
          batchProcessing={batchProcessing}
          batchResult={batchResult}
          style={colStyle('focus')}
          collapsed={layout.focus.collapsed}
          onToggleCollapse={() => toggleCollapse('focus')}
        />
      </div>
    </div>
  );
}
