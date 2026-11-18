// Hand-rolled lexer + recursive-descent parser for the search
// mini-language:
//
//   term    := QUOTED_STRING | WORD | /regex/flags
//   near    := term "NEAR/" NUMBER term   (word-distance, order-independent)
//   field   := FIELD ":" term             (FIELD in subject|body|from|to|attachment|filename|translation)
//   primary := field | near | term | "(" expr ")"
//   unary   := "NOT" primary | primary
//   and_e   := unary ("AND" unary | unary)*   (bare whitespace also means AND)
//   expr    := and_e ("OR" and_e)*
//
// Known limitation, by design rather than oversight: a bare (unquoted)
// term containing a literal "/" (e.g. a URL) will be misread as the
// start of a regex, since "/" is what opens regex-literal syntax here.
// Quote such terms ("http://example.com") instead of leaving them bare.

export class SearchSyntaxError extends Error {
  constructor(message, position) {
    super(position != null ? `${message} (at position ${position})` : message);
    this.name = 'SearchSyntaxError';
    this.position = position ?? null;
  }
}

const FIELD_NAMES = new Set(['subject', 'body', 'from', 'to', 'attachment', 'filename', 'translation']);

function isBoundaryChar(ch) {
  return ch === undefined || /\s/.test(ch) || ch === '(' || ch === ')' || ch === '"' || ch === '/';
}

function splitFieldPrefix(raw) {
  const colonIdx = raw.indexOf(':');
  if (colonIdx <= 0) return null;
  const field = raw.slice(0, colonIdx).toLowerCase();
  if (!FIELD_NAMES.has(field)) return null;
  return { field, rest: raw.slice(colonIdx + 1) };
}

/**
 * Splits a query string into tokens: WORD, QUOTED, REGEX, FIELD, NEAR,
 * AND, OR, NOT, LPAREN, RPAREN. Each token carries `pos` (its start
 * offset in the original string) for error reporting.
 */
function lex(input) {
  const tokens = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', pos: i });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', pos: i });
      i++;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        if (input[i] === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (input[i] === '"') {
          closed = true;
          i++;
          break;
        }
        value += input[i];
        i++;
      }
      if (!closed) throw new SearchSyntaxError('Unterminated quoted string', start);
      tokens.push({ type: 'QUOTED', value, pos: start });
      continue;
    }

    if (ch === '/') {
      const start = i;
      i++;
      let source = '';
      let closed = false;
      while (i < n) {
        if (input[i] === '\\' && input[i + 1] === '/') {
          source += '/';
          i += 2;
          continue;
        }
        if (input[i] === '/') {
          closed = true;
          i++;
          break;
        }
        source += input[i];
        i++;
      }
      if (!closed) throw new SearchSyntaxError('Unterminated regex literal', start);
      const flagsStart = i;
      while (i < n && /[a-z]/i.test(input[i])) i++;
      const flags = input.slice(flagsStart, i);
      try {
        // eslint-disable-next-line no-new
        new RegExp(source, flags);
      } catch (err) {
        throw new SearchSyntaxError(`Invalid regex /${source}/${flags}: ${err.message}`, start);
      }
      tokens.push({ type: 'REGEX', source, flags, pos: start });
      continue;
    }

    // Bare word run, stopping at whitespace/parens/quote/slash -- except
    // "NEAR/<digits>" is special-cased so the '/' there doesn't get
    // mistaken for a regex-literal start.
    const start = i;
    while (i < n && !isBoundaryChar(input[i])) i++;
    if (input[i] === '/' && input.slice(start, i).toUpperCase() === 'NEAR') {
      let j = i + 1;
      while (j < n && /[0-9]/.test(input[j])) j++;
      if (j > i + 1) i = j;
    }
    const raw = input.slice(start, i);
    if (raw.length === 0) {
      // Shouldn't happen (isBoundaryChar covers every char we didn't
      // already handle above), but guard against an infinite loop.
      throw new SearchSyntaxError(`Unexpected character '${ch}'`, i);
    }

    const upper = raw.toUpperCase();
    const nearMatch = /^NEAR\/(\d+)$/i.exec(raw);
    if (upper === 'AND') {
      tokens.push({ type: 'AND', pos: start });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR', pos: start });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT', pos: start });
    } else if (nearMatch) {
      tokens.push({ type: 'NEAR', distance: Number(nearMatch[1]), pos: start });
    } else {
      const fieldSplit = splitFieldPrefix(raw);
      if (fieldSplit) {
        tokens.push({ type: 'FIELD', field: fieldSplit.field, pos: start });
        if (fieldSplit.rest.length > 0) {
          tokens.push({ type: 'WORD', value: fieldSplit.rest, pos: start });
        }
      } else {
        tokens.push({ type: 'WORD', value: raw, pos: start });
      }
    }
  }

  tokens.push({ type: 'EOF', pos: n });
  return tokens;
}

// Token types that can legally begin a new primary/unary expression --
// used to detect an implicit AND when two terms sit next to each other
// with no explicit operator between them (e.g. `foo bar` means
// `foo AND bar`).
const IMPLICIT_AND_START = new Set(['WORD', 'QUOTED', 'REGEX', 'FIELD', 'NOT', 'LPAREN']);

function createParser(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];
  const expect = (type) => {
    const tok = peek();
    if (tok.type !== type) throw new SearchSyntaxError(`Expected ${type} but found ${tok.type}`, tok.pos);
    return advance();
  };

  function parseTerm() {
    const tok = peek();
    if (tok.type === 'WORD') {
      advance();
      return { type: 'Word', value: tok.value };
    }
    if (tok.type === 'QUOTED') {
      advance();
      return { type: 'Phrase', value: tok.value };
    }
    if (tok.type === 'REGEX') {
      advance();
      return { type: 'Regex', source: tok.source, flags: tok.flags };
    }
    throw new SearchSyntaxError(`Expected a search term but found ${tok.type}`, tok.pos);
  }

  function parsePrimary() {
    const tok = peek();
    if (tok.type === 'LPAREN') {
      advance();
      const node = parseExpr();
      expect('RPAREN');
      return node;
    }
    if (tok.type === 'FIELD') {
      advance();
      const term = parseTerm();
      return { type: 'Field', field: tok.field, term };
    }
    const left = parseTerm();
    if (peek().type === 'NEAR') {
      const nearTok = advance();
      const right = parseTerm();
      return { type: 'Near', left, right, distance: nearTok.distance };
    }
    return left;
  }

  function parseUnary() {
    if (peek().type === 'NOT') {
      advance();
      return { type: 'Not', node: parseUnary() };
    }
    return parsePrimary();
  }

  function parseAnd() {
    let node = parseUnary();
    while (true) {
      const tok = peek();
      if (tok.type === 'AND') {
        advance();
        node = { type: 'And', left: node, right: parseUnary() };
      } else if (IMPLICIT_AND_START.has(tok.type)) {
        node = { type: 'And', left: node, right: parseUnary() };
      } else {
        break;
      }
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (peek().type === 'OR') {
      advance();
      node = { type: 'Or', left: node, right: parseAnd() };
    }
    return node;
  }

  function parseExpr() {
    return parseOr();
  }

  return { parseExpr, peek };
}

/**
 * Parses a query string into an AST. Throws SearchSyntaxError (with a
 * `position` property) on malformed input -- callers (src/search/run-search.js)
 * are expected to catch this and surface it as a user-facing message
 * rather than letting it propagate as an uncaught exception.
 */
export function parseQuery(queryString) {
  const tokens = lex(queryString);
  const parser = createParser(tokens);
  const ast = parser.parseExpr();
  const trailing = parser.peek();
  if (trailing.type !== 'EOF') {
    throw new SearchSyntaxError(`Unexpected token ${trailing.type}`, trailing.pos);
  }
  return ast;
}
