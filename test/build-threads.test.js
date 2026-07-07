import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreads } from '../src/threading/build-threads.js';

function comm({ id, subject, messageId = null, inReplyTo = null, references = [], timestamp = 0, participants = [], datasetId = 1 }) {
  return {
    id,
    datasetId,
    subject,
    messageId,
    inReplyTo,
    referencesJson: JSON.stringify(references),
    timestamp,
    participants: participants.map((identifier, i) => ({ role: i === 0 ? 'from' : 'to', identifier, sortOrder: i })),
  };
}

test('header-linked messages group into one thread even with unrelated subjects/participants', () => {
  const a = comm({ id: 1, subject: 'Totally different subject 1', messageId: 'a@x', participants: ['alice@x.com', 'bob@x.com'] });
  const b = comm({ id: 2, subject: 'Totally different subject 2', inReplyTo: 'a@x', participants: ['carol@x.com', 'dave@x.com'] });

  const threads = buildThreads([a, b]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].method, 'header');
  assert.equal(threads[0].messageCount, 2);
});

test('subject+participant fallback groups messages with no header links', () => {
  const c = comm({ id: 3, subject: 'Re: Meeting notes', participants: ['alice@x.com', 'bob@x.com'] });
  const d = comm({ id: 4, subject: 'Meeting notes', participants: ['bob@x.com', 'eve@x.com'] });

  const threads = buildThreads([c, d]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].method, 'subject-fallback');
  assert.equal(threads[0].messageCount, 2);
});

test('matching subject but zero participant overlap does NOT group', () => {
  const e = comm({ id: 5, subject: 'Quarterly Report', participants: ['x@x.com'] });
  const f = comm({ id: 6, subject: 'Re: Quarterly Report', participants: ['y@y.com'] });

  const threads = buildThreads([e, f]);
  assert.equal(threads.length, 2);
  assert.ok(threads.every((t) => t.messageCount === 1));
});

test('references array gives transitive grouping across three messages', () => {
  const g = comm({ id: 7, subject: 's1', messageId: 'g@x' });
  const h = comm({ id: 8, subject: 's2', messageId: 'h@x', inReplyTo: 'g@x' });
  const i = comm({ id: 9, subject: 's3', references: ['g@x', 'h@x'] });

  const threads = buildThreads([g, h, i]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].method, 'header');
  assert.equal(threads[0].messageCount, 3);
});

test('a message with no header link and no subject/participant match is its own singleton thread', () => {
  const j = comm({ id: 10, subject: 'Unique subject nobody shares', participants: ['solo@x.com'] });

  const threads = buildThreads([j]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].method, 'singleton');
  assert.equal(threads[0].messageCount, 1);
});

test('dateRange and participants are computed correctly across a thread', () => {
  const c = comm({ id: 3, subject: 'Re: Meeting notes', participants: ['alice@x.com', 'bob@x.com'], timestamp: 2000 });
  const d = comm({ id: 4, subject: 'Meeting notes', participants: ['bob@x.com', 'eve@x.com'], timestamp: 1000 });

  const threads = buildThreads([c, d]);
  assert.equal(threads[0].dateRange.start, 1000);
  assert.equal(threads[0].dateRange.end, 2000);
  assert.deepEqual(threads[0].participants.sort(), ['alice@x.com', 'bob@x.com', 'eve@x.com'].sort());
  // members sorted by timestamp ascending
  assert.equal(threads[0].members[0].communicationId, 4);
  assert.equal(threads[0].members[1].communicationId, 3);
});

test('empty input returns no threads', () => {
  assert.deepEqual(buildThreads([]), []);
});
