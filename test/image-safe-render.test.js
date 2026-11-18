import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import UTIF from 'utif2';
import { renderSafeJpeg } from '../src/extract/image-safe-render.js';

const W = 4;
const H = 3;

// A small, distinctive RGBA pattern -- solid red, used to sanity-check
// the decoded pixels actually came from the real image, not a blank
// fallback some decoder might return on a near-miss.
function makeRgba() {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 220; // R
    data[i * 4 + 1] = 20; // G
    data[i * 4 + 2] = 20; // B
    data[i * 4 + 3] = 255; // A
  }
  return data;
}

function buildBmp24(width, height) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const dataOffset = 54;
  const fileSize = dataOffset + pixelArraySize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(dataOffset, 10);
  buf.writeUInt32LE(40, 14); // BITMAPINFOHEADER size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive -- bottom-up
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // BI_RGB, uncompressed

  // Bottom-up: row 0 in the file is the BOTTOM row of the image. Fill
  // every row identically here since the fixture is a solid color.
  for (let row = 0; row < height; row++) {
    const rowStart = dataOffset + row * rowSize;
    for (let col = 0; col < width; col++) {
      const px = rowStart + col * 3;
      buf[px] = 20; // B
      buf[px + 1] = 20; // G
      buf[px + 2] = 220; // R
    }
  }
  return buf;
}

test('renderSafeJpeg round-trips a real JPEG to a new, valid JPEG', () => {
  const original = jpeg.encode({ width: W, height: H, data: makeRgba() }, 90).data;
  const result = renderSafeJpeg(original, 'image/jpeg');
  assert.ok(result, 'must produce output');
  assert.notDeepEqual(result, original, 'must be a freshly re-encoded buffer, not the original bytes');

  const redecoded = jpeg.decode(result, { useTArray: true });
  assert.equal(redecoded.width, W);
  assert.equal(redecoded.height, H);
  // Lossy JPEG re-encode won't be byte-exact -- just confirm it's still
  // recognizably the same solid-red image, not noise or a blank frame.
  assert.ok(redecoded.data[0] > 180 && redecoded.data[1] < 60, 'decoded pixel still reads as the original red color');
});

test('renderSafeJpeg converts a PNG to a valid JPEG', () => {
  const png = new PNG({ width: W, height: H });
  png.data = Buffer.from(makeRgba());
  const original = PNG.sync.write(png);

  const result = renderSafeJpeg(original, 'image/png');
  assert.ok(result, 'must produce output');
  const redecoded = jpeg.decode(result, { useTArray: true });
  assert.equal(redecoded.width, W);
  assert.equal(redecoded.height, H);
});

test('renderSafeJpeg converts an uncompressed 24-bit BMP to a valid JPEG', () => {
  const original = buildBmp24(W, H);
  const result = renderSafeJpeg(original, 'image/bmp');
  assert.ok(result, 'must produce output');
  const redecoded = jpeg.decode(result, { useTArray: true });
  assert.equal(redecoded.width, W);
  assert.equal(redecoded.height, H);
  assert.ok(redecoded.data[0] > 180 && redecoded.data[2] < 60, 'BGR-to-RGB channel order was handled correctly');
});

test('renderSafeJpeg converts a TIFF to a valid JPEG', () => {
  const original = Buffer.from(UTIF.encodeImage(makeRgba(), W, H));
  const result = renderSafeJpeg(original, 'image/tiff');
  assert.ok(result, 'must produce output');
  const redecoded = jpeg.decode(result, { useTArray: true });
  assert.equal(redecoded.width, W);
  assert.equal(redecoded.height, H);
});

test('renderSafeJpeg returns null for an unsupported format (WebP) rather than throwing', () => {
  const fakeWebp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii');
  assert.equal(renderSafeJpeg(fakeWebp, 'image/webp'), null);
});

test('renderSafeJpeg returns null (not a throw) for genuinely corrupt bytes claiming a supported type', () => {
  const garbage = Buffer.from('not actually an image at all, just text pretending to be one');
  assert.equal(renderSafeJpeg(garbage, 'image/jpeg'), null);
  assert.equal(renderSafeJpeg(garbage, 'image/png'), null);
  assert.equal(renderSafeJpeg(garbage, 'image/bmp'), null);
  assert.equal(renderSafeJpeg(garbage, 'image/tiff'), null);
});

test('renderSafeJpeg returns null for a BMP using an unsupported compression/bit-depth', () => {
  const bmp = buildBmp24(W, H);
  bmp.writeUInt16LE(8, 28); // claim 8 bits/pixel (paletted) -- not supported
  assert.equal(renderSafeJpeg(bmp, 'image/bmp'), null);
});
