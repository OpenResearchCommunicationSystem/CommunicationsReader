function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

import CollapsedStrip from './CollapsedStrip.jsx';

// One item's "has this been translated yet" signal, shared by the body
// row and each attachment row -- translatedAt is the same done/pending
// marker src/translate/translate-batch.js keys off server-side, so this
// badge and the batch preview/run counts can never disagree about what's
// actually pending.
function TranslationStatusBadge({ translatedAt }) {
  return (
    <span className={`batch-status-badge ${translatedAt ? 'done' : 'pending'}`}>
      {translatedAt ? 'Translated' : 'Pending'}
    </span>
  );
}

function FocusItemStatus({ item }) {
  // Only attachments with extracted text are ever translatable -- an
  // attachment with nothing extracted (unsupported format, or an image,
  // which never gets OCR'd automatically and keeps no original bytes to
  // OCR later either) has no translation state to show at all.
  const translatableAttachments = (item.attachments || []).filter((a) => a.extractedText);
  return (
    <div className="focus-item-status">
      <div className="focus-item-status-row">
        <span>Body</span>
        <TranslationStatusBadge translatedAt={item.translatedAt} />
      </div>
      {translatableAttachments.map((a) => (
        <div className="focus-item-status-row" key={a.id}>
          <span title={a.filename}>{a.filename}</span>
          <TranslationStatusBadge translatedAt={a.translatedAt} />
        </div>
      ))}
    </div>
  );
}

function BatchProcessingControls({
  focusSet,
  aiAvailable,
  batchSelection,
  onToggleBatchSelection,
  onSelectAllInFocus,
  onSelectNoneInFocus,
  batchPreview,
  onPreviewBatch,
  onConfirmBatch,
  onCancelBatchPreview,
  batchProcessing,
  batchResult,
}) {
  if (!aiAvailable || focusSet.length === 0) return null;

  const selectedCount = batchSelection.size;

  return (
    <div className="batch-processing">
      <div className="batch-processing-header">
        <strong>Send selected for processing</strong>
        <span className="batch-selection-links">
          <button type="button" className="link-button" onClick={onSelectAllInFocus}>All</button>
          <button type="button" className="link-button" onClick={onSelectNoneInFocus}>None</button>
        </span>
      </div>
      <div className="batch-processing-row">
        <button
          type="button"
          className="batch-preview-button"
          disabled={selectedCount === 0 || batchProcessing}
          onClick={onPreviewBatch}
        >
          Preview ({selectedCount} selected)&hellip;
        </button>
      </div>

      {batchPreview && (
        <div className="batch-preview">
          <p>
            <strong>{batchPreview.bodiesPending}</strong> message bod{batchPreview.bodiesPending === 1 ? 'y' : 'ies'} and{' '}
            <strong>{batchPreview.attachmentsPending}</strong> attachment text
            {batchPreview.attachmentsPending === 1 ? '' : 's'} will actually be sent to the AI endpoint.
          </p>
          {batchPreview.attachmentsDeduped > 0 && (
            <p className="batch-preview-deduped">
              {batchPreview.attachmentsDeduped} more attachment{batchPreview.attachmentsDeduped === 1 ? '' : 's'} will be
              filled in for free (identical content, same hash as one already being translated above) -- never sent
              twice.
            </p>
          )}
          {(batchPreview.bodiesSkipped > 0 || batchPreview.attachmentsSkipped > 0) && (
            <p className="batch-preview-skipped">
              Already translated, will be skipped: {batchPreview.bodiesSkipped} bod
              {batchPreview.bodiesSkipped === 1 ? 'y' : 'ies'}, {batchPreview.attachmentsSkipped} attachment text
              {batchPreview.attachmentsSkipped === 1 ? '' : 's'}.
            </p>
          )}
          {batchPreview.bodiesPending === 0 && batchPreview.attachmentsPending === 0 && batchPreview.attachmentsDeduped === 0 ? (
            <p className="batch-preview-nothing">Nothing to do -- everything selected is already translated.</p>
          ) : (
            <div className="batch-preview-actions">
              <button type="button" onClick={onConfirmBatch} disabled={batchProcessing}>
                {batchProcessing ? 'Processing…' : 'Confirm & run'}
              </button>
              <button type="button" onClick={onCancelBatchPreview} disabled={batchProcessing}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {batchResult && !batchPreview && (
        <div className="batch-result">
          Done: {batchResult.bodiesTranslated} bod{batchResult.bodiesTranslated === 1 ? 'y' : 'ies'} and{' '}
          {batchResult.attachmentsTranslated} attachment text{batchResult.attachmentsTranslated === 1 ? '' : 's'} actually
          sent to the AI endpoint
          {batchResult.attachmentsDeduped > 0 && <> (plus {batchResult.attachmentsDeduped} filled in free via dedup)</>}
          ({batchResult.bodiesSkipped + batchResult.attachmentsSkipped} already done, skipped).
          {batchResult.errors.length > 0 && (
            <ul className="batch-result-errors">
              {batchResult.errors.map((e, i) => (
                <li key={i}>{e.type} #{e.id}: {e.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function FocusPanel({
  focusSet,
  selectedCommunicationId,
  onSelect,
  onRemove,
  onClear,
  onMaterialize,
  materializing,
  materializeStatus,
  onExportText,
  exportingText,
  exportTextStatus,
  aiAvailable,
  onOpenCollectionAnalysis,
  batchSelection,
  onToggleBatchSelection,
  onSelectAllInFocus,
  onSelectNoneInFocus,
  batchPreview,
  onPreviewBatch,
  onConfirmBatch,
  onCancelBatchPreview,
  batchProcessing,
  batchResult,
  style,
  collapsed,
  onToggleCollapse,
}) {
  if (collapsed) {
    return (
      <div className="focus-panel panel-collapsed" style={style}>
        <CollapsedStrip label={`Focus (${focusSet.length})`} onExpand={onToggleCollapse} />
      </div>
    );
  }

  return (
    <div className="focus-panel" style={style}>
      <div className="panel-header">
        <h2>Focus ({focusSet.length})</h2>
        <button className="collapse-toggle" onClick={onToggleCollapse} title="Collapse">&laquo;</button>
      </div>
      <div className="focus-actions">
        <button className="focus-materialize-button" onClick={onMaterialize} disabled={focusSet.length === 0 || materializing}>
          {materializing ? 'Exporting…' : 'Export focus set…'}
        </button>
        <button className="focus-clear-button" onClick={onClear} disabled={focusSet.length === 0}>
          Clear
        </button>
      </div>
      {aiAvailable && (
        <div className="focus-actions" title="Summarize the whole Focus Set, extract named entities, or ask follow-up questions about it via the configured AI endpoint">
          <button
            className="focus-analyze-collection-button"
            onClick={onOpenCollectionAnalysis}
            disabled={focusSet.length === 0}
          >
            Analyze Collection&hellip;
          </button>
        </div>
      )}
      {materializeStatus && (
        <div className={`focus-materialize-status ${materializeStatus.error ? 'error' : 'success'}`}>
          {materializeStatus.error
            ? materializeStatus.error
            : `Exported ${materializeStatus.communicationCount} message(s) from ${materializeStatus.datasetCount} dataset(s) to ${materializeStatus.outputDir}. ${materializeStatus.uniqueFiles} unique attachment file(s) written (saved ${materializeStatus.duplicatesSaved} duplicate ${materializeStatus.duplicatesSaved === 1 ? 'copy' : 'copies'}).`}
        </div>
      )}
      <div className="focus-actions" title="Plain-text transcript for pasting/uploading into an external LLM chat -- not the same as the DB export above">
        <button
          className="focus-export-text-button"
          onClick={() => onExportText('plain')}
          disabled={focusSet.length === 0 || exportingText}
        >
          {exportingText ? 'Exporting…' : 'Export as .txt…'}
        </button>
        <button
          className="focus-export-text-button"
          onClick={() => onExportText('markup')}
          disabled={focusSet.length === 0 || exportingText}
        >
          {exportingText ? 'Exporting…' : 'Export as .txt (structured)…'}
        </button>
      </div>
      {exportTextStatus && (
        <div className={`focus-materialize-status ${exportTextStatus.error ? 'error' : 'success'}`}>
          {exportTextStatus.error
            ? exportTextStatus.error
            : `Exported ${exportTextStatus.communicationCount} message(s) to ${exportTextStatus.filePath}.`}
        </div>
      )}
      <BatchProcessingControls
        focusSet={focusSet}
        aiAvailable={aiAvailable}
        batchSelection={batchSelection}
        onToggleBatchSelection={onToggleBatchSelection}
        onSelectAllInFocus={onSelectAllInFocus}
        onSelectNoneInFocus={onSelectNoneInFocus}
        batchPreview={batchPreview}
        onPreviewBatch={onPreviewBatch}
        onConfirmBatch={onConfirmBatch}
        onCancelBatchPreview={onCancelBatchPreview}
        batchProcessing={batchProcessing}
        batchResult={batchResult}
      />
      <ul>
        {focusSet.map((item) => (
          <li key={item.id}>
            <div className="focus-row-wrapper">
              <input
                type="checkbox"
                className="focus-select-checkbox"
                checked={batchSelection.has(item.id)}
                onChange={() => onToggleBatchSelection(item.id)}
                title="Select for batch processing"
              />
              <button
                className={`focus-row ${item.id === selectedCommunicationId ? 'selected' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <div className="focus-subject">{item.subject || '(no subject)'}</div>
                <div className="focus-date">{formatDateTime(item.timestamp)}</div>
              </button>
              <button className="remove-from-focus-button icon-only" onClick={() => onRemove(item.id)} title="Remove from focus">
                &times;
              </button>
            </div>
            <FocusItemStatus item={item} />
          </li>
        ))}
        {focusSet.length === 0 && (
          <li className="empty-state">Nothing in focus yet. Add a message or a whole thread to start building a working set.</li>
        )}
      </ul>
    </div>
  );
}
