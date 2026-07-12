import { useState } from 'react';

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Deliberately separate from both Message Content Search (the token_index
// full-text search) and the Reference ID lookup -- a content hash is a
// third, distinct identifier type (universal, not scoped to this dataset;
// see ReferenceJump.jsx's comment for the full three-way distinction) and
// mixing it into either of the other two would silently misinterpret one
// kind of pasted value as another, the exact bug fixed in ReferenceJump.
export default function HashSearch({ onSearch, onSelectResult }) {
  const [value, setValue] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const hash = value.trim();
    if (!hash) {
      setError('Enter an attachment content hash to search for.');
      setResults(null);
      return;
    }
    try {
      const matches = await onSearch(hash);
      setResults(matches);
      setError(matches.length === 0 ? 'No attachments found with that hash.' : null);
    } catch (err) {
      setError(err.message);
      setResults(null);
    }
  }

  return (
    <form className="hash-search" onSubmit={submit}>
      <div className="hash-search-row">
        <label className="hash-search-label" htmlFor="hash-search-input">Attachment Hash ID Search:</label>
        <input
          id="hash-search-input"
          type="text"
          className="hash-search-input"
          placeholder="Paste a content hash…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="hash-search-button">Search</button>
        {error && <span className="hash-search-error">{error}</span>}
      </div>
      {results && results.length > 0 && (
        <ul className="hash-search-results">
          {results.map((r) => (
            <li key={r.attachmentId}>
              <button type="button" className="hash-search-result" onClick={() => onSelectResult(r)}>
                <span className="hash-search-result-filename">{r.filename || '(unnamed)'}</span>
                <span className="hash-search-result-subject">{r.subject || '(no subject)'}</span>
                <span className="hash-search-result-date">{formatDateTime(r.timestamp)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
