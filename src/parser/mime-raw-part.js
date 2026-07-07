// Minimal, self-contained MIME walker used ONLY to recover the raw,
// pre-charset-decoded bytes of a message's primary text body part.
//
// mailparser (via message-parse.js) already does full, correct MIME
// structural parsing (headers, attachments, nested parts) and decodes body
// text using the charset declared in each part's Content-Type header. The
// problem this file solves is narrower and different: some source mail
// servers mislabel that declared charset (e.g. Windows-1256 bytes labeled
// as UTF-8), so encoding-detect.js needs access to the *raw undecoded
// bytes* of the primary text part to run its own chardet-based
// verification/override pass. mailparser does not expose those raw
// pre-decode bytes through its public API, so this module re-derives them
// directly from the raw message buffer with a small, purpose-built (not
// general-purpose) MIME reader.
//
// This is intentionally independent of mailparser's internals: it is a
// best-effort auxiliary path. If it fails to find/parse a part, callers
// should fall back to trusting mailparser's own decoded text untouched.

function splitHeaderAndBody(buf) {
  const idxCRLF = buf.indexOf('\r\n\r\n');
  const idxLF = buf.indexOf('\n\n');
  let idx;
  let sepLen;
  if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF <= idxLF)) {
    idx = idxCRLF;
    sepLen = 4;
  } else if (idxLF !== -1) {
    idx = idxLF;
    sepLen = 2;
  } else {
    idx = buf.length;
    sepLen = 0;
  }
  return { headerBuf: buf.subarray(0, idx), bodyBuf: buf.subarray(idx + sepLen) };
}

function parseHeaders(headerBuf) {
  // Header field names/structure are ASCII-safe per RFC 5322/2045; 'binary'
  // (latin1) gives a lossless byte<->char mapping sufficient for locating
  // Content-Type/Content-Transfer-Encoding and their parameters.
  const text = headerBuf.toString('binary');
  const lines = text.split(/\r\n|\n/);
  const headers = {};
  let currentName = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && currentName) {
      headers[currentName] += ' ' + line.trim();
    } else {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        currentName = m[1].trim().toLowerCase();
        headers[currentName] = m[2];
      } else {
        currentName = null;
      }
    }
  }
  return headers;
}

function parseContentType(value) {
  if (!value) return { type: 'text/plain', params: {} };
  const segments = value.split(';').map((s) => s.trim());
  const type = segments[0].toLowerCase();
  const params = {};
  for (const seg of segments.slice(1)) {
    const m = seg.match(/^([^=]+)=(.*)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      params[m[1].trim().toLowerCase()] = val;
    }
  }
  return { type, params };
}

function decodeQuotedPrintable(buf) {
  const str = buf.toString('binary');
  const noSoftBreaks = str.replace(/=\r\n/g, '').replace(/=\n/g, '');
  const bytes = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const isHexEscape =
      noSoftBreaks[i] === '=' &&
      i + 2 < noSoftBreaks.length &&
      /^[0-9A-Fa-f]{2}$/.test(noSoftBreaks.slice(i + 1, i + 3));
    if (isHexEscape) {
      bytes.push(parseInt(noSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(noSoftBreaks.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeTransferEncoding(buf, cte) {
  const enc = (cte || '7bit').toLowerCase().trim();
  if (enc === 'base64') {
    const str = buf.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
    return Buffer.from(str, 'base64');
  }
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(buf);
  }
  return buf;
}

function splitMultipartBody(bodyBuf, boundary) {
  const delimBuf = Buffer.from('--' + boundary);
  const positions = [];
  let searchStart = 0;
  let idx;
  while ((idx = bodyBuf.indexOf(delimBuf, searchStart)) !== -1) {
    positions.push(idx);
    searchStart = idx + delimBuf.length;
  }
  const parts = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const afterDelim = positions[i] + delimBuf.length;
    let lineEnd = bodyBuf.indexOf(0x0a, afterDelim);
    if (lineEnd === -1) lineEnd = bodyBuf.length;
    const partStart = lineEnd + 1;
    const partEnd = positions[i + 1];
    if (partEnd > partStart) {
      parts.push(bodyBuf.subarray(partStart, partEnd));
    }
  }
  return parts;
}

function findInMultipart(bodyBuf, boundary, depth) {
  if (depth > 5) return null;
  const rawParts = splitMultipartBody(bodyBuf, boundary);
  let htmlFallback = null;

  for (const partBuf of rawParts) {
    const { headerBuf, bodyBuf: partBody } = splitHeaderAndBody(partBuf);
    const headers = parseHeaders(headerBuf);
    const { type, params } = parseContentType(headers['content-type']);

    if (type.startsWith('multipart/') && params.boundary) {
      const nested = findInMultipart(partBody, params.boundary, depth + 1);
      if (nested && nested.contentType === 'text/plain') return nested;
      if (nested && !htmlFallback) htmlFallback = nested;
      continue;
    }

    if (type === 'text/plain') {
      const decoded = decodeTransferEncoding(partBody, headers['content-transfer-encoding']);
      return { rawContentBytes: decoded, charsetHint: params.charset, contentType: type };
    }
    if (type === 'text/html' && !htmlFallback) {
      const decoded = decodeTransferEncoding(partBody, headers['content-transfer-encoding']);
      htmlFallback = { rawContentBytes: decoded, charsetHint: params.charset, contentType: type };
    }
  }

  return htmlFallback;
}

/**
 * Locates the primary text/plain (preferred) or text/html (fallback) body
 * part of a raw RFC 5322 message and returns its raw bytes *before*
 * charset decoding (transfer-encoding, e.g. quoted-printable/base64, has
 * already been undone).
 *
 * Returns { rawContentBytes: Buffer, charsetHint: string|undefined,
 * contentType: string } or null if no text part could be located.
 */
export function findPrimaryTextPart(rawBytes) {
  const { headerBuf, bodyBuf } = splitHeaderAndBody(rawBytes);
  const headers = parseHeaders(headerBuf);
  const { type, params } = parseContentType(headers['content-type']);

  if (type.startsWith('multipart/') && params.boundary) {
    return findInMultipart(bodyBuf, params.boundary, 0);
  }

  if (type.startsWith('text/') || !headers['content-type']) {
    const decoded = decodeTransferEncoding(bodyBuf, headers['content-transfer-encoding']);
    return { rawContentBytes: decoded, charsetHint: params.charset, contentType: type || 'text/plain' };
  }

  return null;
}
