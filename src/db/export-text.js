import { listFocusSet } from './focus-set.js';

function formatDate(ts) {
  if (!ts) return '(no date)';
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function dateRangeLabel(communications) {
  const timestamps = communications.map((c) => c.timestamp).filter(Boolean);
  if (timestamps.length === 0) return '(no dated messages)';
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return min === max ? formatDate(min) : `${formatDate(min)} to ${formatDate(max)}`;
}

function datasetLabels(db, communications) {
  const ids = [...new Set(communications.map((c) => c.datasetId))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db
    .prepare(`SELECT label FROM datasets WHERE id IN (${placeholders})`)
    .all(...ids)
    .map((r) => r.label || '(unlabeled dataset)');
}

// Uses the structured participants table (populated from headers at import
// time) rather than re-parsing fromRaw/toRaw/ccRaw strings here -- the
// parsing work is already done once, correctly, at insert time; redoing it
// with ad hoc string splitting would just reintroduce the same edge cases
// (display-name quoting, multi-address lists) that table exists to solve.
// Purpose: give a reader (human or LLM) the cast of characters up front,
// instead of making them build that map by reading every message first.
function participantRoster(communications) {
  const byIdentifier = new Map();
  for (const c of communications) {
    for (const p of c.participants || []) {
      const key = p.identifier || p.displayName;
      if (!key) continue;
      if (!byIdentifier.has(key)) byIdentifier.set(key, { identifier: p.identifier, displayName: p.displayName, count: 0 });
      byIdentifier.get(key).count++;
    }
  }
  return [...byIdentifier.values()].sort((a, b) => b.count - a.count);
}

// Builds one message block in either plain or lightly-marked-up form. Both
// modes are always saved with a .txt extension (see the IPC handler) --
// "markup" only changes what characters sit inside the file, e.g. "##"
// headers and "---" rules that a downstream LLM parses as structure whether
// or not any human ever renders them as Markdown.
function formatMessage(comm, index, markup) {
  const lines = [];
  // Includes the DB row id (this app's user-facing term: "Reference ID") so
  // a finding can be pointed back at an exact record ("Reference ID
  // comm-4821 mentions X") instead of only "message 7 of this export",
  // which stops meaning anything once the file is separated from this app.
  const heading = `Message ${index} of the focus set (Reference ID: comm-${comm.id})`;
  lines.push(markup ? `## ${heading}` : `${heading}\n${'='.repeat(heading.length)}`);
  const field = (label, value) => lines.push(markup ? `**${label}:** ${value || '(none)'}` : `${label}: ${value || '(none)'}`);
  field('Date', formatDate(comm.timestamp));
  field('From', comm.fromRaw);
  field('To', comm.toRaw);
  if (comm.ccRaw) field('Cc', comm.ccRaw);
  field('Subject', comm.subject);
  // threadId reflects this message's ORIGINAL conversation, independent of
  // its position in this hand-curated focus set -- without it, two messages
  // that land next to each other here (because the investigator put them
  // there) but came from different original threads could be misread as
  // continuous, especially if they happen to share a generic subject line.
  field('Original thread', comm.threadId);

  const dataQualityNotes = [];
  if (comm.encodingUncertain) dataQualityNotes.push('encoding was uncertain when this body text was decoded');
  if (comm.charsetOverridden) dataQualityNotes.push('the declared character encoding was overridden at import');
  if (dataQualityNotes.length > 0) {
    const note = `${dataQualityNotes.join('; ')} -- treat unusual or garbled characters below with caution, they may be a decoding artifact rather than the original content.`;
    lines.push(markup ? `**Data-quality note:** ${note}` : `Data-quality note: ${note}`);
  }
  lines.push('');

  lines.push(comm.bodyEmpty ? '(empty body)' : comm.bodyText || '(no extracted body text)');

  if (comm.translatedText) {
    lines.push('');
    lines.push(
      markup
        ? `**Machine translation (from ${comm.translatedLang || 'unknown source language'}):**`
        : `Machine translation (from ${comm.translatedLang || 'unknown source language'}):`
    );
    lines.push(comm.translatedText);
  }

  if (comm.attachments && comm.attachments.length > 0) {
    lines.push('');
    lines.push(markup ? '**Attachments:**' : 'Attachments:');
    for (const att of comm.attachments) {
      const status = att.extractionStatus === 'attempted_succeeded' ? 'text extracted' : att.extractionStatus;
      const hashLabel = att.contentHash ? `, Hash ID: ${att.contentHash}` : '';
      lines.push(`- ${att.filename || '(unnamed)'} (${status}${hashLabel})`);
      if (att.extractionStatus === 'attempted_succeeded' && att.extractedText) {
        lines.push(markup ? '```' : '  ---');
        lines.push(att.extractedText);
        lines.push(markup ? '```' : '  ---');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Formats the current focus set as a single self-contained transcript,
 * meant to be pasted or uploaded into an external LLM chat interface for
 * further analysis -- deliberately NOT the same artifact as
 * materializeFocusSet() (a portable SQLite DB for reopening in this app).
 * Preserves focus-set add-order (the investigator's own curated sequence,
 * see listFocusSet()), not timestamp order -- if they built "their own
 * thread" by hand, that ordering is the point.
 *
 * format: 'plain' (no markup characters at all) or 'markup' (Markdown-ish
 * headers/rules/fences) -- both are always written with a .txt extension by
 * the caller, since "markup" only changes the characters inside the file,
 * not how the OS treats it.
 */
export function formatFocusSetText(db, { format = 'plain' } = {}) {
  const communications = listFocusSet(db);
  if (communications.length === 0) {
    throw new Error('Focus set is empty -- add at least one message or thread before exporting.');
  }
  const markup = format === 'markup';

  const roster = participantRoster(communications);
  const rosterLines = roster.map((p) => {
    const name = p.displayName ? `${p.displayName} <${p.identifier}>` : p.identifier;
    return `- ${name} (${p.count} message${p.count === 1 ? '' : 's'})`;
  });

  const header = [
    markup ? '# Focus set export' : 'FOCUS SET EXPORT',
    '',
    `${communications.length} message(s) from dataset(s): ${datasetLabels(db, communications).join(', ')}`,
    `Date range: ${dateRangeLabel(communications)}`,
    `Generated: ${formatDate(Date.now())}`,
    '',
    markup ? '**Participants:**' : 'Participants:',
    ...rosterLines,
    '',
    'Messages are listed in the order the investigator added them to this focus set, not necessarily chronological order.',
    'Each message below has a "Reference ID: comm-N" tag, and each attachment (where available) has a "Hash ID". If you reference a specific message in your analysis, cite its Reference ID exactly -- the investigator can paste it into the source application\'s "Dataset Reference ID Search" to reopen that exact message. Hash IDs are universal (not specific to this dataset) and can be looked up via "Attachment Hash ID Search".',
  ].join('\n');

  const separator = markup ? '\n\n---\n\n' : '\n\n----------------------------------------\n\n';
  const body = communications.map((c, i) => formatMessage(c, i + 1, markup)).join(separator);

  return { text: `${header}${separator}${body}\n`, communicationCount: communications.length };
}
