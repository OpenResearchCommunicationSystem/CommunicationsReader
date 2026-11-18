import CollapsedStrip from './CollapsedStrip.jsx';

export default function DatasetPanel({
  datasets,
  selectedIds,
  onToggle,
  onSelectAll,
  onImportClick,
  onImportAutopsyCaseClick,
  onDelete,
  activeImportKind,
  style,
  collapsed,
  onToggleCollapse,
}) {
  if (collapsed) {
    return (
      <div className="dataset-panel panel-collapsed" style={style}>
        <CollapsedStrip label="Datasets" onExpand={onToggleCollapse} />
      </div>
    );
  }

  return (
    <div className="dataset-panel" style={style}>
      <div className="panel-header">
        <h2>Datasets</h2>
        <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
      </div>
      <div className="import-row">
        <span className="import-row-label">Import</span>
        <button
          className="import-button"
          onClick={onImportClick}
          disabled={Boolean(activeImportKind)}
          title="Import a raw archive (.zip)"
        >
          {activeImportKind === 'archive' ? 'Importing…' : '.ZIP'}
        </button>
        <button
          className="import-button"
          onClick={onImportAutopsyCaseClick}
          disabled={Boolean(activeImportKind)}
          title="Import an existing Autopsy case (reads message content from autopsy.db; attachments come through as hash/metadata only, no file content)"
        >
          {activeImportKind === 'autopsy' ? 'Importing…' : 'Autopsy'}
        </button>
      </div>
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
            <button
              className="delete-dataset-button"
              title="Delete this dataset"
              aria-label={`Delete ${ds.label || `Dataset ${ds.id}`}`}
              disabled={Boolean(activeImportKind)}
              onClick={() => onDelete(ds.id)}
            >
              &times;
            </button>
          </li>
        ))}
        {datasets.length === 0 && <li className="empty-state">No datasets imported yet.</li>}
      </ul>
    </div>
  );
}
