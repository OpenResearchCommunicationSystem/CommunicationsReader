function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MessageList({ thread, selectedCommunicationId, onSelect, matchedIds, focusedIds, onAddToFocus }) {
  if (!thread) {
    return (
      <div className="message-list">
        <div className="panel-header">
          <h2>Messages</h2>
        </div>
        <div className="empty-state">Select a thread to see its messages.</div>
      </div>
    );
  }

  return (
    <div className="message-list">
      <div className="panel-header">
        <h2>{thread.subject || '(no subject)'}</h2>
      </div>
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
