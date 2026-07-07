export default function DatasetPanel({ datasets, selectedIds, onToggle, onSelectAll, onImportClick, onDelete }) {
  return (
    <div className="dataset-panel">
      <div className="panel-header">
        <h2>Datasets</h2>
        <button className="import-button" onClick={onImportClick}>+ Import</button>
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
