import { Brightness } from '../../cam/image-engrave';

/** An image's pixels, RGBA row by row from the top (as `ImageData`). */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * The pixels of the image at `image` (a data URL), drawn at the size `size`
 * picks from its own (whole pixels, at least 1 × 1), scaled with the
 * `smoothing` quality given (the canvas's default otherwise). Transparent
 * areas come out white, like paper.
 */
export async function imagePixels(
  image: string,
  size: (width: number, height: number) => { width: number; height: number },
  smoothing?: ImageSmoothingQuality,
): Promise<Pixels> {
  const blob = await (await fetch(image)).blob();
  const bitmap = await createImageBitmap(blob);
  const wanted = size(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(wanted.width));
  const h = Math.max(1, Math.round(wanted.height));
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  if (smoothing) {
    context.imageSmoothingQuality = smoothing;
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, w, h);
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = context.getImageData(0, 0, w, h);
  return { width: w, height: h, data };
}

/** Brightness of the pixel at `i`, 0–255 (Rec. 601 luma). */
export function brightnessAt(data: Uint8ClampedArray, i: number): number {
  return (
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  );
}

/**
 * The brightness of the image at `image` (a data URL), at the size `size`
 * picks from its own (see `imagePixels`). A 16-bit PNG keeps its depth
 * (the canvas would round it to 8 bits: 256 levels, which a relief or an
 * engraving carves as steps); others are drawn by the canvas.
 */
export async function imageBrightness(
  image: string,
  size: (width: number, height: number) => { width: number; height: number },
  smoothing?: ImageSmoothingQuality,
): Promise<Brightness> {
  const bytes = /^data:image\/png[;,]/i.test(image)
    ? new Uint8Array(await (await fetch(image)).arrayBuffer())
    : null;
  const deep = bytes && isDeepPng(bytes) ? await deepPng(bytes) : null;
  if (deep) {
    const wanted = size(deep.width, deep.height);
    return resample(
      deep,
      Math.max(1, Math.round(wanted.width)),
      Math.max(1, Math.round(wanted.height)),
    );
  }
  const pixels = await imagePixels(image, size, smoothing);
  const data = new Float32Array(pixels.width * pixels.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = brightnessAt(pixels.data, i) / 255;
  }
  return { width: pixels.width, height: pixels.height, data };
}

/** Whether `bytes` are a PNG of 16 bits a channel, not interlaced. */
function isDeepPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return (
    bytes.length > 33 &&
    signature.every((b, i) => bytes[i] === b) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR' &&
    bytes[24] === 16 &&
    [0, 2, 4, 6].includes(bytes[25]) &&
    bytes[28] === 0
  );
}

/**
 * The brightness of a 16-bit PNG (grey or RGB, with or without alpha; see
 * `isDeepPng`), luma as `brightnessAt` reads it, transparent areas white.
 */
async function deepPng(bytes: Uint8Array): Promise<Brightness> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = bytes[25];
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  const inflated = new Blob(idat as BlobPart[])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(inflated).arrayBuffer());

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const step = channels * 2;
  const stride = width * step;
  if (raw.length < height * (stride + 1)) {
    throw new Error('PNG: image data cut short');
  }
  // Undo each line's filter (against the bytes a pixel before and above).
  const lines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? lines[row + x - step] : 0;
      const b = y > 0 ? lines[row - stride + x] : 0;
      const c = x >= step && y > 0 ? lines[row - stride + x - step] : 0;
      let value = raw[from + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      lines[row + x] = value;
    }
  }

  const data = new Float32Array(width * height);
  const sample = (i: number, k: number) =>
    ((lines[(i * channels + k) * 2] << 8) | lines[(i * channels + k) * 2 + 1]) /
    65535;
  for (let i = 0; i < data.length; i++) {
    const grey = colorType === 0 || colorType === 4;
    const luma = grey
      ? sample(i, 0)
      : 0.299 * sample(i, 0) + 0.587 * sample(i, 1) + 0.114 * sample(i, 2);
    const alpha =
      colorType === 4 || colorType === 6 ? sample(i, channels - 1) : 1;
    data[i] = luma * alpha + (1 - alpha);
  }
  return { width, height, data };
}

/**
 * `image` scaled to `width` × `height`, each pixel the mean of what it
 * covers of the image's (one way, then the other).
 */
function resample(
  image: Brightness,
  width: number,
  height: number,
): Brightness {
  if (width === image.width && height === image.height) {
    return image;
  }
  const across = scaleLines(
    image.data,
    image.width,
    image.height,
    width,
    1,
    image.width,
    1,
    width,
  );
  const data = scaleLines(
    across,
    image.height,
    width,
    height,
    width,
    1,
    width,
    1,
  );
  return { width, height, data };
}

/**
 * Lines of `n` values (`step` apart, the lines `stride` apart) scaled to
 * `m` values each (`outStep` apart, `outStride`), each the mean of the
 * span of the line it covers.
 */
function scaleLines(
  values: Float32Array,
  n: number,
  count: number,
  m: number,
  step: number,
  stride: number,
  outStep: number,
  outStride: number,
): Float32Array {
  const out = new Float32Array(m * count);
  const scale = n / m;
  for (let line = 0; line < count; line++) {
    for (let t = 0; t < m; t++) {
      const from = t * scale;
      const to = from + scale;
      let sum = 0;
      for (let s = Math.floor(from); s < Math.min(n, Math.ceil(to)); s++) {
        const cover = Math.min(to, s + 1) - Math.max(from, s);
        sum += values[line * stride + s * step] * cover;
      }
      out[line * outStride + t * outStep] = sum / scale;
    }
  }
  return out;
}
