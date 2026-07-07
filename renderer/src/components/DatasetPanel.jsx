export default function DatasetPanel({ datasets, selectedIds, onToggle, onSelectAll, onImportClick }) {
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
          <li key={ds.id}>
            <label className={`dataset-row ${selectedIds.includes(ds.id) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={selectedIds.includes(ds.id)}
                onChange={() => onToggle(ds.id)}
              />
              <span className="dataset-name">{ds.label || `Dataset ${ds.id}`}</span>
              <span className="dataset-count">{ds.succeededCount}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
