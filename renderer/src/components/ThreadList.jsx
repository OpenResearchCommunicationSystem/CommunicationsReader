function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

import CollapsedStrip from './CollapsedStrip.jsx';

function AttachmentBadge({ count }) {
  if (!count) return null;
  return (
    <span className="attachment-count-badge" title={`${count} attachment${count === 1 ? '' : 's'}`}>
      &#128206; {count}
    </span>
  );
}

export default function ThreadList({ threads, selectedThreadId, onSelect, onAddThreadToFocus, style, collapsed, onToggleCollapse }) {
  if (collapsed) {
    return (
      <div className="thread-list panel-collapsed" style={style}>
        <CollapsedStrip label={`Threads (${threads.length})`} onExpand={onToggleCollapse} />
      </div>
    );
  }

  return (
    <div className="thread-list" style={style}>
      <div className="panel-header">
        <h2>Threads ({threads.length})</h2>
        <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
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
                <AttachmentBadge count={thread.attachmentCount} />
              </div>
              <div className="thread-daterange">
                {formatDate(thread.dateRange.start)} &ndash; {formatDate(thread.dateRange.end)}
              </div>
            </button>
            <button
              className="add-focus-button"
              onClick={() => onAddThreadToFocus(thread)}
              title="Add whole thread to focus"
            >
              +Thread
            </button>
          </li>
        ))}
        {threads.length === 0 && <li className="empty-state">No threads found for this selection.</li>}
      </ul>
    </div>
  );
}
