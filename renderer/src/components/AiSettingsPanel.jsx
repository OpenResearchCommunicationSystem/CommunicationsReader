import { useEffect, useState } from 'react';
import * as api from '../api.js';

// Each preset fills in provider/baseUrl/model defaults when picked --
// all fields stay editable afterward, so picking "OpenAI" doesn't lock
// you out of pointing it at a different model or a proxy in front of
// OpenAI's own endpoint. "Local / organizational gateway" covers
// self-hosted servers (Ollama, LM Studio, vLLM) and an org's own AI
// gateway identically -- they all speak the same OpenAI-compatible wire
// format, so there's no separate provider code for them, just a blank
// baseUrl for the investigator to fill in.
const PROVIDER_PRESETS = [
  { key: 'openai', label: 'OpenAI (ChatGPT)', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'xai', label: 'xAI (Grok)', provider: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3' },
  { key: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  { key: 'custom', label: 'Local / self-hosted / organizational AI gateway', provider: 'openai-compatible', baseUrl: '', model: '' },
];

function presetForConfig(provider, baseUrl) {
  const match = PROVIDER_PRESETS.find((p) => p.provider === provider && p.baseUrl === baseUrl);
  return match ? match.key : 'custom';
}

export default function AiSettingsPanel({ onClose }) {
  const [status, setStatus] = useState(null);
  const [presetKey, setPresetKey] = useState(PROVIDER_PRESETS[0].key);
  const [provider, setProvider] = useState(PROVIDER_PRESETS[0].provider);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].model);
  const [orgId, setOrgId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.getAiConfigStatus().then((s) => {
      setStatus(s);
      if (s.configured) {
        setPresetKey(presetForConfig(s.provider, s.baseUrl));
        setProvider(s.provider);
        setBaseUrl(s.baseUrl);
        setModel(s.model);
        setOrgId(s.orgId);
      }
    });
  }, []);

  function handlePresetChange(key) {
    setPresetKey(key);
    const preset = PROVIDER_PRESETS.find((p) => p.key === key);
    setProvider(preset.provider);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
  }

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      await api.saveAiConfig({ provider, baseUrl, apiKey, model, orgId });
      const refreshed = await api.getAiConfigStatus();
      setStatus(refreshed);
      setApiKey('');
      setResult({ ok: true, message: 'Saved.' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    setSaving(true);
    setResult(null);
    try {
      await api.saveAiConfig({ provider, baseUrl, apiKey: '', model, orgId, clearKey: true });
      const refreshed = await api.getAiConfigStatus();
      setStatus(refreshed);
      setApiKey('');
      setResult({ ok: true, message: 'Key cleared. OCR and translation are now unavailable until a key is saved again.' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel ai-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI Endpoint Settings</h2>
          <button className="collapse-toggle" onClick={onClose} title="Close">&times;</button>
        </div>

        <p className="ai-settings-note">
          Used only for OCR and translation, only when you explicitly trigger them -- never automatically on
          import, never on a batch without you seeing a pending/skip count first. The key is encrypted at rest
          (OS-level) and stored per-machine, never inside a case workspace.
        </p>

        {status && (
          <div className={`ai-settings-status ${status.configured ? 'configured' : 'unconfigured'}`}>
            {status.configured
              ? `Currently configured: ${status.provider} -- ${status.model || '(no model set)'}`
              : 'Not configured -- OCR and translation will report unavailable.'}
          </div>
        )}

        <label className="ai-settings-field">
          Provider
          <select value={presetKey} onChange={(e) => handlePresetChange(e.target.value)} disabled={saving}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="ai-settings-field">
          Base URL
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
            disabled={saving}
          />
        </label>

        <label className="ai-settings-field">
          Model
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={saving} />
        </label>

        {presetKey === 'openai' && (
          <label className="ai-settings-field">
            Org ID (optional)
            <input type="text" value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={saving} />
          </label>
        )}

        <label className="ai-settings-field">
          API Key {status?.configured && <span className="ai-settings-field-hint">(leave blank to keep the saved key)</span>}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.configured ? '••••••••' : 'paste key here'}
            disabled={saving}
            autoComplete="off"
          />
        </label>

        <div className="ai-settings-actions">
          <button onClick={handleSave} disabled={saving || !baseUrl}>{saving ? 'Saving…' : 'Save'}</button>
          {status?.configured && (
            <button onClick={handleClearKey} disabled={saving} className="ai-settings-clear-button">
              Clear saved key
            </button>
          )}
        </div>

        {result && (
          <div className={`ai-settings-result ${result.ok ? 'success' : 'error'}`}>{result.message}</div>
        )}
      </div>
    </div>
  );
}
