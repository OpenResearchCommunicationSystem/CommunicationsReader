import { useEffect, useState } from 'react';
import * as api from '../api.js';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'entities', label: 'Entities' },
  { key: 'ask', label: 'Ask Questions' },
];

function StaleNote({ savedCount, currentCount }) {
  if (savedCount === currentCount) return null;
  return (
    <p className="collection-analysis-stale">
      The Focus Set has changed since this was generated ({savedCount} message{savedCount === 1 ? '' : 's'} then,{' '}
      {currentCount} now) -- re-run to refresh it.
    </p>
  );
}

function SummaryTab({ focusSetIds }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFocusCollectionSummary().then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, []);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await api.analyzeFocusCollection(focusSetIds);
      setSummary(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <p className="collection-analysis-loading">Loading&hellip;</p>;

  return (
    <div className="collection-analysis-tab">
      <button className="analyze-thread-button" onClick={handleAnalyze} disabled={analyzing || focusSetIds.length === 0}>
        {analyzing ? 'Analyzing…' : summary ? 'Re-analyze' : 'Analyze Collection'}
      </button>
      {summary && <StaleNote savedCount={summary.messageCount} currentCount={focusSetIds.length} />}
      {error && <div className="collection-analysis-error">{error}</div>}
      {summary && <p className="thread-summary-text">{summary.summary}</p>}
      {!summary && !error && <p className="empty-state">No summary yet -- click "Analyze Collection" above.</p>}
    </div>
  );
}

function EntitiesTab({ focusSetIds }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFocusEntities().then(setResult).catch(() => setResult(null)).finally(() => setLoading(false));
  }, []);

  async function handleExtract() {
    setExtracting(true);
    setError(null);
    try {
      const extracted = await api.extractFocusEntities(focusSetIds);
      setResult(extracted);
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  if (loading) return <p className="collection-analysis-loading">Loading&hellip;</p>;

  // Grouped by type for scanability -- an investigator cares "show me
  // every person/amount/date mentioned," not the order the AI happened
  // to emit them in.
  const grouped = new Map();
  for (const entity of result?.entities || []) {
    const key = entity.type || 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entity);
  }

  return (
    <div className="collection-analysis-tab">
      <button className="analyze-thread-button" onClick={handleExtract} disabled={extracting || focusSetIds.length === 0}>
        {extracting ? 'Extracting…' : result ? 'Re-extract' : 'Extract Entities'}
      </button>
      {result && <StaleNote savedCount={result.messageCount} currentCount={focusSetIds.length} />}
      {error && <div className="collection-analysis-error">{error}</div>}
      {result && result.entities.length === 0 && <p className="empty-state">No entities found.</p>}
      {[...grouped.entries()].map(([type, entities]) => (
        <div key={type} className="entity-group">
          <h4 className="entity-group-type">{type.replace(/_/g, ' ')} ({entities.length})</h4>
          <ul className="entity-list">
            {entities.map((entity, i) => (
              <li key={i} className="entity-row">
                <span className="entity-value">{entity.value}</span>
                {entity.context && <span className="entity-context" title={entity.context}>{entity.context}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!result && !error && <p className="empty-state">No entities extracted yet -- click "Extract Entities" above.</p>}
    </div>
  );
}

function AskTab({ focusSetIds }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFocusQaMessages().then(setMessages).catch(() => setMessages([])).finally(() => setLoading(false));
  }, []);

  async function handleAsk(e) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || focusSetIds.length === 0) return;
    setAsking(true);
    setError(null);
    const pendingQuestion = { role: 'user', content: trimmed };
    try {
      const result = await api.askFocusQuestion(focusSetIds, trimmed);
      setMessages((prev) => [...prev, pendingQuestion, { role: 'assistant', content: result.answer }]);
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  }

  async function handleClear() {
    try {
      await api.clearFocusQaConversation();
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="collection-analysis-loading">Loading&hellip;</p>;

  return (
    <div className="collection-analysis-tab">
      <div className="qa-chat-header">
        <p className="qa-chat-hint">
          Questions are answered only from the Focus Set's current contents -- this is a triage aid, not an
          evidentiary finding.
        </p>
        {messages.length > 0 && (
          <button type="button" className="link-button" onClick={handleClear} disabled={asking}>
            New conversation
          </button>
        )}
      </div>
      <div className="qa-chat-messages">
        {messages.length === 0 && <p className="empty-state">No questions asked yet.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`qa-chat-message qa-chat-message-${m.role}`}>
            <div className="qa-chat-message-role">{m.role === 'user' ? 'You' : 'AI'}</div>
            <div className="qa-chat-message-content">{m.content}</div>
          </div>
        ))}
      </div>
      {error && <div className="collection-analysis-error">{error}</div>}
      <form className="qa-chat-input-row" onSubmit={handleAsk}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a follow-up question about this collection…"
          disabled={asking || focusSetIds.length === 0}
        />
        <button type="submit" disabled={asking || !question.trim() || focusSetIds.length === 0}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

export default function CollectionAnalysisPanel({ focusSetIds, onClose }) {
  const [activeTab, setActiveTab] = useState('summary');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel collection-analysis-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Analyze Collection</h2>
          <button className="collapse-toggle" onClick={onClose} title="Close">&times;</button>
        </div>
        <p className="ai-settings-note">
          Summarize, extract named entities from, or ask follow-up questions about the {focusSetIds.length} message
          {focusSetIds.length === 1 ? '' : 's'} currently in your Focus Set, via the configured AI endpoint.
        </p>
        <div className="collection-analysis-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`collection-analysis-tab-button ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'summary' && <SummaryTab focusSetIds={focusSetIds} />}
        {activeTab === 'entities' && <EntitiesTab focusSetIds={focusSetIds} />}
        {activeTab === 'ask' && <AskTab focusSetIds={focusSetIds} />}
      </div>
    </div>
  );
}
