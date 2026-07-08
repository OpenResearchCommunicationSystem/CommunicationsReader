function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function FocusPanel({ focusSet, selectedCommunicationId, onSelect, onRemove, onClear, onMaterialize, materializing, materializeStatus }) {
  return (
    <div className="focus-panel">
      <div className="panel-header">
        <h2>Focus ({focusSet.length})</h2>
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
