import { useState } from 'react';

const PLACEHOLDER = 'Search... subject:invoice AND NOT "no reply"  |  /0x[a-f0-9]{40}/i  |  wallet NEAR/5 transfer';

export default function SearchPanel({ onSearch, resultCount, error, hasActiveQuery }) {
  const [value, setValue] = useState('');

  function submit(e) {
    e.preventDefault();
    onSearch(value);
  }

  function clear() {
    setValue('');
    onSearch('');
  }

  return (
    <form className="search-panel" onSubmit={submit}>
      <label className="search-panel-label" htmlFor="message-content-search-input">Message Content Search:</label>
      <input
        id="message-content-search-input"
        type="text"
        className="search-input"
        placeholder={PLACEHOLDER}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        dir="auto"
      />
      <button type="submit" className="search-button">Search</button>
      {hasActiveQuery && (
        <button type="button" className="search-clear-button" onClick={clear}>Clear</button>
      )}
      {error && <span className="search-error">{error}</span>}
      {!error && hasActiveQuery && (
        <span className="search-result-count">{resultCount} message{resultCount === 1 ? '' : 's'} matched</span>
      )}
    </form>
  );
}
