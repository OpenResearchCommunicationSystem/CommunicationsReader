import { useState } from 'react';

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(size) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const EXTRACTION_LABELS = {
  not_attempted: 'Not converted',
  attempted_failed: 'Conversion failed',
  attempted_succeeded: 'Text extracted',
};

// Shared by the message body and each attachment's extracted text --
// translation is investigator-triggered per item (no language-ID model
// exists in this codebase to guess a source language, unlike OCR's
// automatic post-import pass). Local dropdown selection, not lifted to
// App.jsx state, since it's ephemeral per item; ReadingPane is remounted
// (via a `key` on communication.id in App.jsx) whenever the selected
// message changes, so this resets naturally rather than leaking a stale
// selection across messages.
// translationMeta is stored as a JSON string (src/translate/translate.js's
// meta, written verbatim by translate-record.js) -- parsed defensively
// since it's null before the first translation and this is user-facing
// display code, not a trust boundary worth throwing on.
function parseTranslationMeta(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function TranslateControl({ availableTranslateLangs, translating, onTranslate, translatedText, translatedLang, translationMeta }) {
  const codes = Object.keys(availableTranslateLangs || {});
  const [sourceLang, setSourceLang] = useState(codes[0] || '');
  // Lets the investigator pick a different source language after a bad
  // result (wrong language selected, garbage output) instead of being
  // stuck with the first attempt -- reset alongside translatedText via
  // ReadingPane's per-communication `key` remount, same as sourceLang.
  const [retranslating, setRetranslating] = useState(false);

  if (codes.length === 0) return null;

  const showSelector = !translatedText || retranslating;
  const meta = parseTranslationMeta(translationMeta);
  const sourceNumericSpans = meta?.sourceNumericSpans || [];
  const missingSpans = meta?.numericSpansMissingInTranslation || [];

  return (
    <div className="translate-control">
      {showSelector && (
        <>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={translating}>
            {codes.map((code) => (
              <option key={code} value={code}>{availableTranslateLangs[code]}</option>
            ))}
          </select>
          <button
            className="translate-button"
            disabled={translating || !sourceLang}
            onClick={() => {
              setRetranslating(false);
              onTranslate(sourceLang);
            }}
            title="Machine translation, fully offline -- quality varies by language and is not a substitute for a human translator"
          >
            {translating ? 'Translating…' : 'Translate from…'}
          </button>
        </>
      )}
      {translatedText && !retranslating && (
        <div className="translated-text" dir="auto">
          <div className="translated-text-label">
            Machine translation from {availableTranslateLangs[translatedLang] || translatedLang}:
            <button className="retranslate-link" onClick={() => setRetranslating(true)}>Wrong language? Retranslate</button>
          </div>
          {translatedText}
          {missingSpans.length > 0 && (
            <div className="numeric-spans-warning">
              <strong>⚠ Numbers/codes not confirmed in translation:</strong> machine translation is unreliable with
              figures -- these appeared in the original but not verbatim in the translation above, so treat them (and
              any other numbers here) as unverified until checked against the original text: {missingSpans.join(', ')}
            </div>
          )}
          {sourceNumericSpans.length > 0 && (
            <div className="numeric-spans-note">
              Figures/codes detected in original (verify against the translation above): {sourceNumericSpans.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReadingPane({
  communication,
  cryptoMatches,
  onExportAttachment,
  availableTranslateLangs,
  onTranslateCommunication,
  onTranslateAttachment,
  translatingCommunication,
  translatingAttachmentId,
}) {
  if (!communication) {
    return (
      <div className="reading-pane">
        <div className="empty-state">Select a message to read it.</div>
      </div>
    );
  }

  const matchesForThisMessage = (cryptoMatches || []).filter(
    (m) => m.communicationId === communication.id || (communication.attachments || []).some((a) => a.id === m.attachmentId)
  );

  return (
    <div className="reading-pane">
      <div className="message-header">
        <h2>{communication.subject || '(no subject)'}</h2>
        <div className="message-header-row"><strong>From:</strong> {communication.fromRaw || '(unknown)'}</div>
        <div className="message-header-row"><strong>To:</strong> {communication.toRaw || '(unknown)'}</div>
        <div className="message-header-row"><strong>Date:</strong> {formatDateTime(communication.timestamp)}</div>
      </div>

      {matchesForThisMessage.length > 0 && (
        <div className="crypto-flags">
          <strong>Flagged terms:</strong>
          {matchesForThisMessage.map((m, i) => (
            <span key={i} className="crypto-flag-chip" title={m.patternName}>{m.matchedText}</span>
          ))}
        </div>
      )}

      <div className="message-body" dir="auto">
        {communication.bodyEmpty ? (
          <em>No body text &mdash; see attachments below.</em>
        ) : (
          communication.bodyText
        )}
      </div>

      {!communication.bodyEmpty && availableTranslateLangs && onTranslateCommunication && (
        <TranslateControl
          availableTranslateLangs={availableTranslateLangs}
          translating={translatingCommunication}
          onTranslate={(sourceLang) => onTranslateCommunication(communication.id, sourceLang)}
          translatedText={communication.translatedText}
          translatedLang={communication.translatedLang}
          translationMeta={communication.translationMeta}
        />
      )}

      {communication.attachments && communication.attachments.length > 0 && (
        <div className="attachments-section">
          <h3>Attachments ({communication.attachments.length})</h3>
          <ul className="attachments-list">
            {communication.attachments.map((att) => (
              <li key={att.id} className="attachment-item">
                <div className="attachment-row">
                  <span className="attachment-name">{att.filename}</span>
                  <span className="attachment-size">{formatBytes(att.size)}</span>
                  <span className={`extraction-badge extraction-${att.extractionStatus}`}>
                    {EXTRACTION_LABELS[att.extractionStatus] || att.extractionStatus}
                  </span>
                  {att.extractionStatus === 'attempted_succeeded' && (
                    <button className="export-button" onClick={() => onExportAttachment(att.id)} title="Export the extracted/OCR'd text -- never the original file">
                      Export text&hellip;
                    </button>
                  )}
                </div>
                {att.extractionStatus === 'attempted_succeeded' && (
                  <div className="attachment-extracted-text" dir="auto">
                    {att.extractedText ? att.extractedText : <em>(no text found)</em>}
                  </div>
                )}
                {att.extractionStatus === 'attempted_failed' && (
                  <div className="attachment-extraction-error">Extraction failed: {att.extractionError}</div>
                )}
                {att.extractionStatus === 'attempted_succeeded' && att.extractedText && availableTranslateLangs && onTranslateAttachment && (
                  <TranslateControl
                    availableTranslateLangs={availableTranslateLangs}
                    translating={translatingAttachmentId === att.id}
                    onTranslate={(sourceLang) => onTranslateAttachment(att.id, sourceLang)}
                    translatedText={att.translatedText}
                    translatedLang={att.translatedLang}
                    translationMeta={att.translationMeta}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
