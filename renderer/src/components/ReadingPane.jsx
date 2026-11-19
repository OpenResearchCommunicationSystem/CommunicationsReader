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
// translation is investigator-triggered per item, source language
// auto-detected by the AI itself (see src/translate/translate.js).
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

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 10V2.5A1.5 1.5 0 0 1 4.5 1H11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

// Label and value are separate elements on purpose -- user-select: all on
// a single element combining "Hash: " with the value meant a double-click/
// drag-select grabbed the label text too, so a pasted "copy" was never
// actually a clean hash. The copy button is the reliable path (exact
// string, no selection-boundary quirks); user-select: all on just the
// value span is a backup for anyone who prefers to select by hand.
function AttachmentHash({ hash }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked (permissions, non-secure context) --
      // the value is still selectable by hand as a fallback.
    }
  }

  return (
    <div
      className="attachment-hash-row"
      title="This project's own content hash for this exact file (SHA-256 for archive-imported attachments). Universal, not specific to this dataset -- look it up via Attachment Hash ID Search, or write it into a filename/note, even when the original bytes never leave the workspace."
    >
      <span className="attachment-hash-label">Hash ID:</span>
      {hash ? (
        <>
          <span className="attachment-hash-value">{hash}</span>
          <button type="button" className="attachment-hash-copy" onClick={handleCopy} title="Copy Hash ID">
            {copied ? '✓' : <CopyIcon />}
          </button>
        </>
      ) : (
        <span className="attachment-hash-value">(not available)</span>
      )}
    </div>
  );
}

function TranslateControl({ translating, onTranslate, translatedText, translatedLang, translationMeta }) {
  // Lets the investigator re-run translation after a bad result instead
  // of being stuck with the first attempt -- reset alongside
  // translatedText via ReadingPane's per-communication `key` remount.
  const [retranslating, setRetranslating] = useState(false);

  const showButton = !translatedText || retranslating;
  const meta = parseTranslationMeta(translationMeta);
  const sourceNumericSpans = meta?.sourceNumericSpans || [];
  const missingSpans = meta?.numericSpansMissingInTranslation || [];

  return (
    <div className="translate-control">
      {showButton && (
        <button
          className="translate-button"
          disabled={translating}
          onClick={() => {
            setRetranslating(false);
            onTranslate();
          }}
          title="LLM translation via the configured AI endpoint -- source language is detected automatically"
        >
          {translating ? 'Translating…' : 'Translate'}
        </button>
      )}
      {translatedText && !retranslating && (
        <div className="translated-text" dir="auto">
          <div className="translated-text-label">
            LLM translation{translatedLang ? ` from ${translatedLang}` : ''}:
            <button className="retranslate-link" onClick={() => setRetranslating(true)}>Not right? Retranslate</button>
          </div>
          {translatedText}
          {missingSpans.length > 0 && (
            <div className="numeric-spans-warning">
              <strong>⚠ Numbers/codes not confirmed in translation:</strong> LLM translation is unreliable with
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

// Image to Text is the AI-vision OCR action for exactly one attachment --
// confirmed necessary directly (2026-11) after the old dataset-wide
// "Re-run OCR" bulk button re-ran extraction over an entire dataset (not
// just images) with no preview or confirmation, which also meant one
// bad run could clobber already-good extracted text across the whole
// set. Shown only for image-kind attachments (mimeType check -- the real
// kind/magic-byte verification happens server-side regardless), and
// always offered, not just when nothing has been extracted yet, so a
// garbage first result can be retried without re-importing anything.
function ImageToTextControl({ attachmentId, running, onImageToText, alreadyExtracted }) {
  return (
    <button
      className="image-to-text-button"
      disabled={running}
      onClick={() => onImageToText(attachmentId)}
      title="Transcribe this image's text via the configured AI endpoint"
    >
      {running ? 'Converting…' : alreadyExtracted ? 'Re-run Image to Text' : 'Image to Text'}
    </button>
  );
}

export default function ReadingPane({
  communication,
  cryptoMatches,
  onExportAttachment,
  aiAvailable,
  onTranslateCommunication,
  onTranslateAttachment,
  translatingCommunication,
  translatingAttachmentId,
  onImageToText,
  imageToTextAttachmentId,
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
        {communication.attachments && communication.attachments.length > 0 && (
          <div className="message-header-row message-header-attachments">
            &#128206; {communication.attachments.length} attachment{communication.attachments.length === 1 ? '' : 's'}
            {' '}({[...new Set(communication.attachments.map((a) => a.filename?.split('.').pop()?.toLowerCase() || '?'))].join(', ')})
          </div>
        )}
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

      {!communication.bodyEmpty && aiAvailable && onTranslateCommunication && (
        <TranslateControl
          translating={translatingCommunication}
          onTranslate={() => onTranslateCommunication(communication.id)}
          translatedText={communication.translatedText}
          translatedLang={communication.translatedLang}
          translationMeta={communication.translationMeta}
        />
      )}

      {communication.attachments && communication.attachments.length > 0 && (
        <div className="attachments-section">
          <h3>Attachments ({communication.attachments.length})</h3>
          <ul className="attachments-list">
            {communication.attachments.map((att) => {
              const isImage = Boolean(att.mimeType?.startsWith('image/'));
              return (
              <li key={att.id} className="attachment-item">
                <div className="attachment-row">
                  <span className="attachment-name">{att.filename}</span>
                  <span className="attachment-size">{formatBytes(att.size)}</span>
                  <span className={`extraction-badge extraction-${att.extractionStatus}`}>
                    {EXTRACTION_LABELS[att.extractionStatus] || att.extractionStatus}
                  </span>
                  {isImage && onImageToText && (
                    <ImageToTextControl
                      attachmentId={att.id}
                      running={imageToTextAttachmentId === att.id}
                      onImageToText={onImageToText}
                      alreadyExtracted={att.extractionStatus === 'attempted_succeeded'}
                    />
                  )}
                  {att.extractionStatus === 'attempted_succeeded' && (
                    <button className="export-button" onClick={() => onExportAttachment(att.id)} title="Export the extracted/OCR'd text -- never the original file">
                      Export text&hellip;
                    </button>
                  )}
                </div>
                {/* quarantineStatus is a lifecycle separate from extractionStatus
                    (see src/db/schema.js): 'pending' is the normal, unremarkable
                    state for anything never verified (including every ordinary
                    unsupported format), so it gets no badge at all. 'rejected'
                    means the file's actual content didn't match what it claimed
                    to be (or broke a size/complexity limit) and was refused
                    before reaching an extractor -- that's forensically
                    significant on its own, distinct from "just not supported
                    yet", so it's the one state that gets a visibly different,
                    explicit callout here. */}
                {att.quarantineStatus === 'rejected' && (
                  <div className="attachment-quarantine-flag" title="This attachment's actual content did not match what it claimed to be, or exceeded a safety limit -- it was never handed to an extractor.">
                    &#9888; Flagged: {att.quarantineReason}
                  </div>
                )}
                {att.quarantineStatus === 'error' && (
                  <div className="attachment-quarantine-flag attachment-quarantine-flag-minor">
                    Could not verify this file's content: {att.quarantineReason}
                  </div>
                )}
                <AttachmentHash hash={att.contentHash} />
                {att.extractionStatus === 'attempted_succeeded' && (
                  <div className="attachment-extracted-text" dir="auto">
                    {att.extractedText ? att.extractedText : <em>(no text found)</em>}
                  </div>
                )}
                {att.extractionStatus === 'attempted_failed' && (
                  <div className="attachment-extraction-error">Extraction failed: {att.extractionError}</div>
                )}
                {att.extractionStatus === 'attempted_succeeded' && att.extractedText && aiAvailable && onTranslateAttachment && (
                  <TranslateControl
                    translating={translatingAttachmentId === att.id}
                    onTranslate={() => onTranslateAttachment(att.id)}
                    translatedText={att.translatedText}
                    translatedLang={att.translatedLang}
                    translationMeta={att.translationMeta}
                  />
                )}
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
