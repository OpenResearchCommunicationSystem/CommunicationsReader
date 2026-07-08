export default function DatasetPanel({
  datasets,
  selectedIds,
  onToggle,
  onSelectAll,
  onImportClick,
  onImportAutopsyCaseClick,
  onDelete,
  availableLangs,
  selectedLangs,
  onToggleLang,
  onReExtract,
  reExtractingId,
  reExtractStatus,
}) {
  return (
    <div className="dataset-panel">
      <div className="panel-header">
        <h2>Datasets</h2>
        <button className="import-button" onClick={onImportClick}>+ Import</button>
        <button className="import-button" onClick={onImportAutopsyCaseClick} title="Import an existing Autopsy case (reads message content from autopsy.db; attachments come through as hash/metadata only, no file content)">
          + Import Autopsy Case…
        </button>
      </div>
      {availableLangs && (
        <div className="ocr-lang-picker">
          <div className="ocr-lang-picker-label">OCR languages (used by "Re-run OCR")</div>
          <div className="ocr-lang-picker-options">
            {Object.entries(availableLangs).map(([code, name]) => (
              <label key={code} className="ocr-lang-option">
                <input
                  type="checkbox"
                  checked={selectedLangs.includes(code)}
                  onChange={() => onToggleLang(code)}
                />
                {name}
              </label>
            ))}
          </div>
        </div>
      )}
      <button className={`dataset-row all-row ${selectedIds.length === 0 ? 'selected' : ''}`} onClick={onSelectAll}>
        All datasets
      </button>
      <ul className="dataset-list">
        {datasets.map((ds) => (
          <li key={ds.id} className="dataset-list-item">
            <label className={`dataset-row ${selectedIds.includes(ds.id) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={selectedIds.includes(ds.id)}
                onChange={() => onToggle(ds.id)}
              />
              <span className="dataset-name">{ds.label || `Dataset ${ds.id}`}</span>
              <span className="dataset-count">{ds.succeededCount}</span>
            </label>
            {onReExtract && (
              <button
                className="reextract-dataset-button"
                title="Re-run text extraction/OCR for this dataset using the selected languages"
                disabled={reExtractingId === ds.id || selectedLangs.length === 0}
                onClick={() => onReExtract(ds.id)}
              >
                {reExtractingId === ds.id ? 'Running…' : 'Re-run OCR…'}
              </button>
            )}
            <button
              className="delete-dataset-button"
              title="Delete this dataset"
              aria-label={`Delete ${ds.label || `Dataset ${ds.id}`}`}
              onClick={() => onDelete(ds.id)}
            >
              &times;
            </button>
            {reExtractStatus && reExtractStatus[ds.id] && (
              <div className="reextract-status">
                {reExtractStatus[ds.id].error
                  ? `Failed: ${reExtractStatus[ds.id].error}`
                  : `Done: ${reExtractStatus[ds.id].succeeded} succeeded, ${reExtractStatus[ds.id].failed} failed, ${reExtractStatus[ds.id].deduped} deduped`}
              </div>
            )}
          </li>
        ))}
        {datasets.length === 0 && <li className="empty-state">No datasets imported yet.</li>}
      </ul>
    </div>
  );
}
