import DOMMatrixPolyfill from '@thednp/dommatrix';
import { Path2D as Path2DPolyfill } from 'path2d';

// pdfjs-dist's "legacy" Node build still references the browser globals
// DOMMatrix/Path2D/ImageData internally for some PDF features (embedded
// font glyph transforms, color space conversions) even during plain text
// extraction with no rendering. Confirmed by direct reproduction: these
// are genuinely undefined in Electron's main process (it's a real
// Node-like context, not a browser one, despite Electron's Chromium
// heritage) -- our synthetic test PDF fixture never happened to exercise
// this code path, so it went undetected until a real-world PDF hit it.
// Importing this module (before pdfjs-dist -- see pdf.js's import order)
// polyfills just enough to avoid "DOMMatrix is not defined"-style
// crashes. Guarded so a real browser environment's natives are never
// overwritten.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = DOMMatrixPolyfill;
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = Path2DPolyfill;
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}
