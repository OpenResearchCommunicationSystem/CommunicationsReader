import { test } from 'node:test';
import assert from 'node:assert/strict';

// Regression coverage for a real bug found via hands-on testing of the
// packaged app: pdfjs-dist's legacy Node build references the browser
// globals DOMMatrix/Path2D/ImageData for some PDF features (embedded
// font transforms, color space conversions) even during plain text
// extraction -- confirmed these are genuinely undefined in Electron's
// main process. A synthetic test PDF never exercised that code path, so
// it went undetected until a real-world PDF did.

test('does not clobber an already-defined global (e.g. a real browser DOMMatrix)', async () => {
  const sentinel = function FakeExistingDOMMatrix() {};
  const had = globalThis.DOMMatrix;
  globalThis.DOMMatrix = sentinel;
  try {
    // Re-import via a cache-busting query so the module body re-runs.
    await import(`../src/extract/pdfjs-polyfills.js?t=${Date.now()}`);
    assert.equal(globalThis.DOMMatrix, sentinel, 'an existing global must never be overwritten');
  } finally {
    globalThis.DOMMatrix = had;
  }
});

test('polyfills DOMMatrix/Path2D/ImageData when absent, with a usable API shape', async () => {
  const savedDOMMatrix = globalThis.DOMMatrix;
  const savedPath2D = globalThis.Path2D;
  const savedImageData = globalThis.ImageData;
  delete globalThis.DOMMatrix;
  delete globalThis.Path2D;
  delete globalThis.ImageData;

  try {
    await import(`../src/extract/pdfjs-polyfills.js?t=${Date.now()}`);

    assert.equal(typeof globalThis.DOMMatrix, 'function');
    assert.equal(typeof globalThis.Path2D, 'function');
    assert.equal(typeof globalThis.ImageData, 'function');

    const matrix = new globalThis.DOMMatrix();
    assert.equal(typeof matrix.multiply, 'function');
    assert.equal(typeof matrix.translate, 'function');

    const img = new globalThis.ImageData(2, 2);
    assert.equal(img.width, 2);
    assert.equal(img.height, 2);
    assert.equal(img.data.length, 16);
  } finally {
    globalThis.DOMMatrix = savedDOMMatrix;
    globalThis.Path2D = savedPath2D;
    globalThis.ImageData = savedImageData;
  }
});
