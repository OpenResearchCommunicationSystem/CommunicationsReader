import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/db/schema.js';
import { appendEvent, verifyChain } from '../src/audit/audit-log.js';

test('appendEvent: first record has sequenceNumber 1 and null prevRecordHash', () => {
  const db = openDatabase(':memory:');
  const record = appendEvent(db, { eventType: 'app_launch', payload: { version: '1.0.0' } });
  assert.equal(record.sequenceNumber, 1);
  assert.equal(record.prevRecordHash, null);
  assert.ok(record.recordHash);
  db.close();
});

test('appendEvent: sequenceNumber increments and each record chains to the previous recordHash', () => {
  const db = openDatabase(':memory:');
  const first = appendEvent(db, { eventType: 'app_launch' });
  const second = appendEvent(db, { eventType: 'dataset_import_started', subjectRef: '/x.zip', payload: { size: 123 } });
  const third = appendEvent(db, { eventType: 'dataset_import_completed', subjectRef: '1' });

  assert.deepEqual([first.sequenceNumber, second.sequenceNumber, third.sequenceNumber], [1, 2, 3]);
  assert.equal(second.prevRecordHash, first.recordHash);
  assert.equal(third.prevRecordHash, second.recordHash);
  db.close();
});

test('verifyChain: an empty log is trivially valid', () => {
  const db = openDatabase(':memory:');
  const result = verifyChain(db);
  assert.deepEqual(result, { ok: true, checked: 0 });
  db.close();
});

test('verifyChain: a clean chain of several events verifies ok', () => {
  const db = openDatabase(':memory:');
  appendEvent(db, { eventType: 'app_launch' });
  appendEvent(db, { eventType: 'dataset_import_started', subjectRef: '/x.zip' });
  appendEvent(db, { eventType: 'dataset_import_completed', subjectRef: '1', payload: { insertedCount: 5 } });

  const result = verifyChain(db);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 3);
  db.close();
});

test('verifyChain: detects a retroactively edited payload and reports the exact broken sequence number', () => {
  const db = openDatabase(':memory:');
  appendEvent(db, { eventType: 'app_launch' });
  appendEvent(db, { eventType: 'dataset_import_started', subjectRef: '/x.zip', payload: { size: 123 } });
  appendEvent(db, { eventType: 'dataset_import_completed', subjectRef: '1' });

  db.prepare(`UPDATE audit_log SET payloadJson = ? WHERE sequenceNumber = 2`).run(JSON.stringify({ size: 999999 }));

  const result = verifyChain(db);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSequence, 2);
  db.close();
});

test('verifyChain: detects a broken prevRecordHash chain link even when the tampered row is internally self-consistent', () => {
  const db = openDatabase(':memory:');
  appendEvent(db, { eventType: 'app_launch' });
  appendEvent(db, { eventType: 'dataset_import_started' });
  appendEvent(db, { eventType: 'dataset_import_completed' });

  // Point row 3's prevRecordHash at a fabricated value, and recompute its
  // own recordHash to match -- so the "does this row's stored recordHash
  // match its own fields" check alone would NOT catch the tamper. Only
  // cross-checking prevRecordHash against row 2's actual recordHash does.
  const row3 = db.prepare(`SELECT * FROM audit_log WHERE sequenceNumber = 3`).get();
  const fakePrev = '0'.repeat(64);
  const fakeRecordHash = createHash('sha256')
    .update(
      JSON.stringify({
        sequenceNumber: row3.sequenceNumber,
        timestampUtc: row3.timestampUtc,
        eventType: row3.eventType,
        subjectRef: row3.subjectRef,
        payloadJson: row3.payloadJson,
        prevRecordHash: fakePrev,
      })
    )
    .digest('hex');
  db.prepare(`UPDATE audit_log SET prevRecordHash = ?, recordHash = ? WHERE sequenceNumber = 3`).run(fakePrev, fakeRecordHash);

  const result = verifyChain(db);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSequence, 3);
  assert.match(result.reason, /prevRecordHash/);
  db.close();
});
