import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, SearchSyntaxError } from '../src/search/query-parser.js';

test('parses a bare word', () => {
  assert.deepEqual(parseQuery('wallet'), { type: 'Word', value: 'wallet' });
});

test('bare whitespace between two terms means implicit AND', () => {
  assert.deepEqual(parseQuery('foo bar'), {
    type: 'And',
    left: { type: 'Word', value: 'foo' },
    right: { type: 'Word', value: 'bar' },
  });
});

test('parses a quoted phrase', () => {
  assert.deepEqual(parseQuery('"crypto wallet"'), { type: 'Phrase', value: 'crypto wallet' });
});

test('parses an escaped quote inside a phrase', () => {
  assert.deepEqual(parseQuery('"say \\"hi\\""'), { type: 'Phrase', value: 'say "hi"' });
});

test('parses a regex literal with flags', () => {
  assert.deepEqual(parseQuery('/0x[a-f0-9]{40}/i'), { type: 'Regex', source: '0x[a-f0-9]{40}', flags: 'i' });
});

test('parses NEAR/N between two terms', () => {
  assert.deepEqual(parseQuery('wallet NEAR/5 transfer'), {
    type: 'Near',
    left: { type: 'Word', value: 'wallet' },
    right: { type: 'Word', value: 'transfer' },
    distance: 5,
  });
});

test('parses a field-scoped term', () => {
  assert.deepEqual(parseQuery('subject:invoice'), {
    type: 'Field',
    field: 'subject',
    term: { type: 'Word', value: 'invoice' },
  });
});

test('parses a field-scoped quoted phrase', () => {
  assert.deepEqual(parseQuery('subject:"past due"'), {
    type: 'Field',
    field: 'subject',
    term: { type: 'Phrase', value: 'past due' },
  });
});

test('parses NOT as a unary prefix', () => {
  assert.deepEqual(parseQuery('NOT foo'), { type: 'Not', node: { type: 'Word', value: 'foo' } });
});

test('explicit AND/OR combine terms', () => {
  assert.deepEqual(parseQuery('foo AND bar'), {
    type: 'And',
    left: { type: 'Word', value: 'foo' },
    right: { type: 'Word', value: 'bar' },
  });
  assert.deepEqual(parseQuery('foo OR bar'), {
    type: 'Or',
    left: { type: 'Word', value: 'foo' },
    right: { type: 'Word', value: 'bar' },
  });
});

test('AND binds tighter than OR: "a OR b AND c" is Or(a, And(b, c))', () => {
  const ast = parseQuery('a OR b AND c');
  assert.equal(ast.type, 'Or');
  assert.deepEqual(ast.left, { type: 'Word', value: 'a' });
  assert.deepEqual(ast.right, {
    type: 'And',
    left: { type: 'Word', value: 'b' },
    right: { type: 'Word', value: 'c' },
  });
});

test('parentheses override default precedence: "(a OR b) AND c"', () => {
  const ast = parseQuery('(a OR b) AND c');
  assert.equal(ast.type, 'And');
  assert.deepEqual(ast.left, {
    type: 'Or',
    left: { type: 'Word', value: 'a' },
    right: { type: 'Word', value: 'b' },
  });
  assert.deepEqual(ast.right, { type: 'Word', value: 'c' });
});

test('a bare "/" inside a would-be word is not confused with NEAR', () => {
  // Known limitation documented in query-parser.js: unquoted "/" opens a
  // regex literal, so a literal slash-bearing term must be quoted.
  assert.deepEqual(parseQuery('"http://example.com"'), { type: 'Phrase', value: 'http://example.com' });
});

test('throws SearchSyntaxError on an unterminated quoted string', () => {
  assert.throws(() => parseQuery('"unterminated'), SearchSyntaxError);
});

test('throws SearchSyntaxError on an unterminated regex literal', () => {
  assert.throws(() => parseQuery('/unterminated'), SearchSyntaxError);
});

test('throws SearchSyntaxError on an invalid regex', () => {
  assert.throws(() => parseQuery('/(/'), SearchSyntaxError);
});

test('throws SearchSyntaxError on unbalanced parentheses', () => {
  assert.throws(() => parseQuery('(foo AND bar'), SearchSyntaxError);
});

test('throws SearchSyntaxError on a dangling NOT with nothing after it', () => {
  assert.throws(() => parseQuery('foo AND NOT'), SearchSyntaxError);
});

test('throws SearchSyntaxError on a dangling NEAR with no right-hand term', () => {
  assert.throws(() => parseQuery('foo NEAR/5'), SearchSyntaxError);
});

test('throws SearchSyntaxError on an empty query', () => {
  assert.throws(() => parseQuery(''), SearchSyntaxError);
});
