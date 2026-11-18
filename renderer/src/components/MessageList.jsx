function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function ThreadSummaryBlock({ thread, threadSummary, analyzingThread, onAnalyzeThread }) {
  const isStale = threadSummary != null && threadSummary.messageCount !== thread.messageCount;

  return (
    <div className="thread-summary-block">
      <div className="thread-summary-header">
        <button
          className="analyze-thread-button"
          onClick={() => onAnalyzeThread(thread)}
          disabled={analyzingThread}
          title="Summarize this thread with the configured AI endpoint"
        >
          {analyzingThread ? 'Analyzing…' : threadSummary ? 'Re-analyze' : 'Analyze Thread'}
        </button>
        {isStale && !analyzingThread && (
          <span className="thread-summary-stale">
            {thread.messageCount - threadSummary.messageCount} new message{thread.messageCount - threadSummary.messageCount === 1 ? '' : 's'} since this summary
          </span>
        )}
      </div>
      {threadSummary && (
        <p className="thread-summary-text">{threadSummary.summary}</p>
      )}
    </div>
  );
}

export default function MessageList({ thread, selectedCommunicationId, onSelect, matchedIds, focusedIds, onAddToFocus, threadSummary, analyzingThread, onAnalyzeThread, style, collapsed, onToggleCollapse }) {
  if (collapsed) {
    return (
      <div className="message-list panel-collapsed" style={style}>
        <CollapsedStrip label={thread ? (thread.subject || '(no subject)') : 'Messages'} onExpand={onToggleCollapse} />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="message-list" style={style}>
        <div className="panel-header">
          <h2>Messages</h2>
          <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
        </div>
        <div className="empty-state">Select a thread to see its messages.</div>
      </div>
    );
  }

  return (
    <div className="message-list" style={style}>
      <div className="panel-header">
        <h2>{thread.subject || '(no subject)'}</h2>
        <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
      </div>
      <ThreadSummaryBlock
        thread={thread}
        threadSummary={threadSummary}
        analyzingThread={analyzingThread}
        onAnalyzeThread={onAnalyzeThread}
      />
      <ul>
        {thread.members.map((member) => {
          const isDimmed = matchedIds != null && !matchedIds.has(member.communicationId);
          const isFocused = focusedIds != null && focusedIds.has(member.communicationId);
          return (
            <li key={member.communicationId}>
              <button
                className={`message-row ${member.communicationId === selectedCommunicationId ? 'selected' : ''} ${isDimmed ? 'search-dimmed' : ''}`}
                onClick={() => onSelect(member.communicationId)}
              >
                <div className="message-date">{formatDateTime(member.timestamp)}</div>
                <div className="message-subject">{member.subject}</div>
                <AttachmentBadge count={member.attachments?.count} />
              </button>
              <button
                className={`add-focus-button icon-only ${isFocused ? 'is-focused' : ''}`}
                onClick={() => onAddToFocus(member.communicationId)}
                title={isFocused ? 'Already in focus' : 'Add to focus'}
              >
                {isFocused ? '✓' : '+'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
