import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import UTIF from 'utif2';

// Safe-rendering means a full decode to raw pixels followed by a fresh
// JPEG re-encode -- the output literally cannot carry forward whatever
// made the original bytes unsafe (a polyglot file, a crafted exploit
// targeting some other parser, trailing data after the real image ends),
// since it's reconstructed from scratch out of decoded pixel data, not
// copied. All three decoders here are pure JS, zero native dependencies
// -- confirmed deliberately (2026-11), after concluding a full
// CanvasRenderingContext2D (what PDF-to-image rendering would actually
// need) has no safe pure-JS equivalent, but a raster decode/re-encode
// does.
//
// WebP is deliberately NOT supported -- no mature pure-JS WebP decoder
// exists; a real one would need a WASM-based libwebp, which is its own
// dependency decision, not bundled into this pass. A WebP attachment
// falls through to the caller's existing "couldn't render, purge it"
// fallback, same as before this module existed.
const JPEG_QUALITY = 85;

function decodeJpeg(buffer) {
  const { width, height, data } = jpeg.decode(buffer, { useTArray: true });
  return { width, height, data };
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

function decodeTiff(buffer) {
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) return null;
  UTIF.decodeImage(buffer, ifds[0]);
  const data = UTIF.toRGBA8(ifds[0]);
  return { width: ifds[0].width, height: ifds[0].height, data };
}

// Minimal uncompressed-BMP decoder -- covers the common real-world case
// (BITMAPINFOHEADER, BI_RGB, 24 or 32 bits/pixel) and returns null for
// anything else (RLE compression, a palette, the legacy 12-byte OS/2
// header) rather than guessing. BMP stores rows bottom-up by default
// (top-down only when the header's height is negative), pixel order is
// BGR, not RGB, and each row is padded to a 4-byte boundary -- none of
// that is optional, it's the format.
function decodeBmp(buffer) {
  if (buffer.length < 54 || buffer[0] !== 0x42 || buffer[1] !== 0x4d) return null; // "BM"
  const dataOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize < 40) return null; // pre-Windows-3.0 OS/2 header, not supported

  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  if (compression !== 0) return null; // only uncompressed BI_RGB
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return null;
  if (width <= 0) return null;

  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bytesPerPixel = bitsPerPixel / 8;
  const rowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row++) {
    const srcRow = topDown ? row : height - 1 - row;
    const rowStart = dataOffset + srcRow * rowSize;
    if (rowStart + width * bytesPerPixel > buffer.length) return null; // truncated

    for (let col = 0; col < width; col++) {
      const srcIdx = rowStart + col * bytesPerPixel;
      const dstIdx = (row * width + col) * 4;
      data[dstIdx] = buffer[srcIdx + 2]; // R
      data[dstIdx + 1] = buffer[srcIdx + 1]; // G
      data[dstIdx + 2] = buffer[srcIdx]; // B
      data[dstIdx + 3] = 255; // A
    }
  }

  return { width, height, data };
}

const DECODERS = {
  'image/jpeg': decodeJpeg,
  'image/png': decodePng,
  'image/bmp': decodeBmp,
  'image/tiff': decodeTiff,
};

/**
 * Decodes an image attachment's bytes and re-encodes them as a fresh
 * JPEG. Returns the JPEG Buffer on success, or null if the format isn't
 * one of the four supported here (notably WebP) or the bytes don't
 * actually decode (corrupt, disguised, or a decoder-specific limitation
 * like BMP compression/palette modes). Never throws -- a decode failure
 * is an ordinary, expected outcome for this function, not an error.
 */
export function renderSafeJpeg(buffer, mimeType) {
  const decode = DECODERS[mimeType];
  if (!decode) return null;

  let decoded;
  try {
    decoded = decode(buffer);
  } catch {
    return null;
  }
  if (!decoded || !decoded.width || !decoded.height) return null;

  try {
    return jpeg.encode(decoded, JPEG_QUALITY).data;
  } catch {
    return null;
  }
}
