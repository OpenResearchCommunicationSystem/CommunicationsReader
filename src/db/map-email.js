// The one file that knows email-specific field names. insert.js and
// schema.js stay source-agnostic; a future SMS/UFDR/Penlink parser gets
// its own map-*.js producing this same generic shape, with zero changes
// to insert.js or the schema.

function buildParticipants(list, role) {
  return (list || []).map((entry, i) => ({
    role,
    identifier: entry.address || entry.name || '',
    displayName: entry.name || null,
    sortOrder: i,
  }));
}

/**
 * Maps a Milestone-1 normalized message object (see src/parser/message-parse.js)
 * into the generic { communication, participants, attachments } shape that
 * src/db/insert.js writes to the database. Pure function, no DB access.
 */
export function mapEmailMessageToCommunication(message, datasetId) {
  const communication = {
    datasetId,
    sourceType: 'email',
    commType: 'message',

    timestamp: message.date ?? null,
    durationSeconds: null,

    subject: message.subject ?? null,
    bodyText: message.bodyText ?? '',
    bodyHtml: message.bodyHtml ?? null,
    bodyEmpty: message.bodyEmpty ? 1 : 0,

    fromRaw: message.from ?? null,
    toRaw: message.to ?? null,
    ccRaw: message.cc ?? null,

    direction: null,

    threadId: null,
    messageId: message.messageId ?? null,
    inReplyTo: message.inReplyTo ?? null,
    referencesJson: JSON.stringify(message.references ?? []),

    rawHash: message.rawHash,
    normalizedHash: message.normalizedHash,

    encodingUncertain: message.encodingUncertain ? 1 : 0,
    charsetOverridden: message.charsetOverridden ? 1 : 0,

    sourceRef: JSON.stringify(message.sourceInfo ?? null),
    sourceSpecific: null,

    createdAt: Date.now(),
  };

  const participants = [
    ...buildParticipants(message.fromList, 'from'),
    ...buildParticipants(message.toList, 'to'),
    ...buildParticipants(message.ccList, 'cc'),
  ];

  const attachments = (message.attachments || []).map((att) => ({
    filename: att.filename ?? null,
    size: att.size ?? null,
    mimeType: att.mimeType ?? null,
    savedPath: att.savedPath ?? null,
  }));

  return { communication, participants, attachments };
}
