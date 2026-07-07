import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubject } from '../src/threading/normalize-subject.js';

test('strips a single Re: prefix, case-insensitively', () => {
  assert.equal(normalizeSubject('Re: Hello there'), 'hello there');
  assert.equal(normalizeSubject('RE: Hello there'), 'hello there');
  assert.equal(normalizeSubject('re:Hello there'), 'hello there');
});

test('strips Fwd:/Fw: prefixes', () => {
  assert.equal(normalizeSubject('Fwd: Hello there'), 'hello there');
  assert.equal(normalizeSubject('Fw: Hello there'), 'hello there');
});

test('strips stacked prefixes', () => {
  assert.equal(normalizeSubject('Re: Fwd: Re: Hello there'), 'hello there');
});

test('collapses whitespace', () => {
  assert.equal(normalizeSubject('Hello   there\t\tfriend'), 'hello there friend');
});

test('empty/null subject normalizes to empty string', () => {
  assert.equal(normalizeSubject(null), '');
  assert.equal(normalizeSubject(''), '');
});

test('subject with no prefix is unaffected apart from case/whitespace', () => {
  assert.equal(normalizeSubject('  Golestan Charter Details  '), 'golestan charter details');
});
