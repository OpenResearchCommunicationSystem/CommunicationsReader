import { useState } from 'react';

// Two different identifier types exist in this app and must never be
// conflated: a "comm-N" / bare-N Reference ID is a database primary key,
// unique to and only meaningful within this app's own dataset (see
// export-text.js's "Reference ID: comm-N" tags). A content hash is
// universal -- meaningful across tools -- and is looked up separately, via
// HashSearch.jsx's "Attachment Hash ID Search". Anchored, digits-only match
// so a pasted hash (which contains letters a-f) is rejected outright
// instead of a loose /(\d+)/ silently grabbing its first digit run and
// looking up the wrong thing -- confirmed as a real bug: a pasted hash
// starting "9f8c..." was silently interpreted as Reference ID 9.
const REFERENCE_PATTERN = /^(?:comm-)?(\d+)$/;
const HASH_SHAPED_PATTERN = /^[0-9a-f]{16,}$/i;

export default function ReferenceJump({ onJump }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    const match = trimmed.match(REFERENCE_PATTERN);
    if (!match) {
      setError(
        HASH_SHAPED_PATTERN.test(trimmed)
          ? 'That looks like a content hash, not a Reference ID -- use Attachment Hash ID Search instead.'
          : 'Enter a Reference ID like comm-4821 or just 4821.'
      );
      return;
    }
    const result = await onJump(Number(match[1]));
    setError(result?.error || null);
  }

  function clear() {
    setValue('');
    setError(null);
  }

  return (
    <form className="reference-jump" onSubmit={submit} title="Paste a Reference ID from an exported transcript to reopen that exact message">
      <label className="reference-jump-label" htmlFor="reference-jump-input">Dataset Reference ID Search:</label>
      <input
        id="reference-jump-input"
        type="text"
        className="reference-jump-input"
        placeholder="comm-4821"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="reference-jump-button">Go</button>
      {(value || error) && (
        <button type="button" className="reference-jump-clear-button" onClick={clear}>Clear</button>
      )}
      {error && <span className="reference-jump-error">{error}</span>}
    </form>
  );
}
