// What traceBitmap needs from the browser, for Node: createImageBitmap for
// PNG images (8 bits per channel, not interlaced) and an OffscreenCanvas
// that can fill white, draw a bitmap over it (nearest pixel) and read it.
import { inflateSync } from 'node:zlib';

type Bitmap = {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
  close(): void;
};

function decodePng(bytes: Uint8Array): Bitmap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = bytes[at + 16];
      colorType = bytes[at + 17];
      if (depth !== 8 || bytes[at + 20] !== 0) {
        throw new Error('PNG: only 8-bit, non-interlaced images');
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG: color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c =
        x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, (i + 1) * channels);
    const [r, g, b, alpha] =
      colorType === 0
        ? [p[0], p[0], p[0], 255]
        : colorType === 2
          ? [p[0], p[1], p[2], 255]
          : colorType === 3
            ? [
                palette![p[0] * 3],
                palette![p[0] * 3 + 1],
                palette![p[0] * 3 + 2],
                255,
              ]
            : colorType === 4
              ? [p[0], p[0], p[0], p[1]]
              : [p[0], p[1], p[2], p[3]];
    rgba.set([r, g, b, alpha], i * 4);
  }
  return { width, height, data: rgba, close() {} };
}

class Canvas {
  private data: Uint8ClampedArray;
  fillStyle = '#000';
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return this;
  }
  fillRect() {
    // Only ever white paper here.
    this.data.fill(255);
  }
  drawImage(bitmap: Bitmap, _x: number, _y: number, w: number, h: number) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(
          bitmap.width - 1,
          Math.floor((x * bitmap.width) / w),
        );
        const sy = Math.min(
          bitmap.height - 1,
          Math.floor((y * bitmap.height) / h),
        );
        const s = (sy * bitmap.width + sx) * 4;
        const d = (y * this.width + x) * 4;
        const alpha = bitmap.data[s + 3] / 255;
        for (let k = 0; k < 3; k++) {
          this.data[d + k] =
            bitmap.data[s + k] * alpha + this.data[d + k] * (1 - alpha);
        }
      }
    }
  }
  getImageData() {
    return { data: this.data };
  }
}

export function installImagePolyfill() {
  const g = globalThis as Record<string, unknown>;
  g['createImageBitmap'] = async (blob: Blob) =>
    decodePng(new Uint8Array(await blob.arrayBuffer()));
  g['OffscreenCanvas'] = Canvas;
}
