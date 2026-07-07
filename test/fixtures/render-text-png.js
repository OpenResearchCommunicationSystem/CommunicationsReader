import { deflateSync } from 'node:zlib';

// A tiny hand-drawn 5x7 dot-matrix font, just enough glyphs to render the
// OCR test fixture's text. Not a general-purpose font -- purpose-built so
// the OCR test doesn't need a committed binary image or an image-drawing
// library/native dependency.
const FONT = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Renders uppercase text (letters present in FONT, plus spaces) to a
 * grayscale PNG buffer, scaled up so OCR has enough resolution to work
 * with. Returns a Buffer containing a valid PNG file.
 */
export function renderTextToPng(text, scale = 8, marginPx = 40) {
  const chars = text.toUpperCase().split('');
  for (const ch of chars) {
    if (!FONT[ch]) throw new Error(`renderTextToPng: no glyph for character ${JSON.stringify(ch)}`);
  }

  const glyphPxW = GLYPH_W * scale;
  const glyphPxH = GLYPH_H * scale;
  const spacing = scale; // gap between glyphs
  const width = marginPx * 2 + chars.length * (glyphPxW + spacing) - spacing;
  const height = marginPx * 2 + glyphPxH;

  // 8-bit grayscale, white background (255), black glyph pixels (0).
  const pixels = new Uint8Array(width * height).fill(255);

  chars.forEach((ch, charIndex) => {
    const glyph = FONT[ch];
    const originX = marginPx + charIndex * (glyphPxW + spacing);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = originX + gx * scale + sx;
              const py = marginPx + gy * scale + sy;
              pixels[py * width + px] = 0;
            }
          }
        }
      }
    }
  });

  // Raw scanlines, each prefixed with a filter-type byte (0 = None).
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) {
      raw[y * (width + 1) + 1 + x] = pixels[y * width + x];
    }
  }

  const idatData = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
