function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ThreadList({ threads, selectedThreadId, onSelect }) {
  return (
    <div className="thread-list">
      <div className="panel-header">
        <h2>Threads ({threads.length})</h2>
      </div>
      <ul>
        {threads.map((thread) => (
          <li key={thread.threadId}>
            <button
              className={`thread-row ${thread.threadId === selectedThreadId ? 'selected' : ''}`}
              onClick={() => onSelect(thread.threadId)}
            >
              <div className="thread-subject">{thread.subject || '(no subject)'}</div>
              <div className="thread-meta">
                <span className={`method-badge method-${thread.method}`}>
                  {thread.method === 'header' ? 'Linked by headers' : thread.method === 'subject-fallback' ? 'Grouped by subject' : 'Single message'}
                </span>
                <span>{thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}</span>
              </div>
              <div className="thread-daterange">
                {formatDate(thread.dateRange.start)} &ndash; {formatDate(thread.dateRange.end)}
              </div>
            </button>
          </li>
        ))}
        {threads.length === 0 && <li className="empty-state">No threads found for this selection.</li>}
      </ul>
    </div>
  );
}
