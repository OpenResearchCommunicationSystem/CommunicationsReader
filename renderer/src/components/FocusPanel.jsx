function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

import CollapsedStrip from './CollapsedStrip.jsx';

export default function FocusPanel({
  focusSet,
  selectedCommunicationId,
  onSelect,
  onRemove,
  onClear,
  onMaterialize,
  materializing,
  materializeStatus,
  onExportText,
  exportingText,
  exportTextStatus,
  style,
  collapsed,
  onToggleCollapse,
}) {
  if (collapsed) {
    return (
      <div className="focus-panel panel-collapsed" style={style}>
        <CollapsedStrip label={`Focus (${focusSet.length})`} onExpand={onToggleCollapse} />
      </div>
    );
  }

  return (
    <div className="focus-panel" style={style}>
      <div className="panel-header">
        <h2>Focus ({focusSet.length})</h2>
        <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
      </div>
      <div className="focus-actions">
        <button className="focus-materialize-button" onClick={onMaterialize} disabled={focusSet.length === 0 || materializing}>
          {materializing ? 'Exporting…' : 'Export focus set…'}
        </button>
        <button className="focus-clear-button" onClick={onClear} disabled={focusSet.length === 0}>
          Clear
        </button>
      </div>
      {materializeStatus && (
        <div className={`focus-materialize-status ${materializeStatus.error ? 'error' : 'success'}`}>
          {materializeStatus.error
            ? materializeStatus.error
            : `Exported ${materializeStatus.communicationCount} message(s) from ${materializeStatus.datasetCount} dataset(s) to ${materializeStatus.outputDir}. ${materializeStatus.uniqueFiles} unique attachment file(s) written (saved ${materializeStatus.duplicatesSaved} duplicate ${materializeStatus.duplicatesSaved === 1 ? 'copy' : 'copies'}).`}
        </div>
      )}
      <div className="focus-actions" title="Plain-text transcript for pasting/uploading into an external LLM chat -- not the same as the DB export above">
        <button
          className="focus-export-text-button"
          onClick={() => onExportText('plain')}
          disabled={focusSet.length === 0 || exportingText}
        >
          {exportingText ? 'Exporting…' : 'Export as .txt…'}
        </button>
        <button
          className="focus-export-text-button"
          onClick={() => onExportText('markup')}
          disabled={focusSet.length === 0 || exportingText}
        >
          {exportingText ? 'Exporting…' : 'Export as .txt (structured)…'}
        </button>
      </div>
      {exportTextStatus && (
        <div className={`focus-materialize-status ${exportTextStatus.error ? 'error' : 'success'}`}>
          {exportTextStatus.error
            ? exportTextStatus.error
            : `Exported ${exportTextStatus.communicationCount} message(s) to ${exportTextStatus.filePath}.`}
        </div>
      )}
      <ul>
        {focusSet.map((item) => (
          <li key={item.id}>
            <button
              className={`focus-row ${item.id === selectedCommunicationId ? 'selected' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <div className="focus-subject">{item.subject || '(no subject)'}</div>
              <div className="focus-date">{formatDateTime(item.timestamp)}</div>
            </button>
            <button className="remove-from-focus-button icon-only" onClick={() => onRemove(item.id)} title="Remove from focus">
              &times;
            </button>
          </li>
        ))}
        {focusSet.length === 0 && (
          <li className="empty-state">Nothing in focus yet. Add a message or a whole thread to start building a working set.</li>
        )}
      </ul>
    </div>
  );
}
