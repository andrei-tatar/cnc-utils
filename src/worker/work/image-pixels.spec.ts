import { imageBrightness } from './image-pixels';

/**
 * A PNG of 16 bits a channel as a data URL: `lines` are each line's filter
 * byte and its bytes, already filtered (the CRCs are left 0: not read).
 */
async function deepPng(
  width: number,
  height: number,
  colorType: number,
  lines: number[][],
): Promise<string> {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([16, colorType, 0, 0, 0], 8);
  const compressed = new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(lines.flat())])
        .stream()
        .pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const bytes = new Uint8Array(
    await new Blob([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', compressed),
      chunk('IEND', new Uint8Array()),
    ] as BlobPart[]).arrayBuffer(),
  );
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** 16-bit values as big-endian bytes. */
const wide = (...values: number[]) => values.flatMap((v) => [v >> 8, v & 255]);

describe('imageBrightness', () => {
  const asIs = (width: number, height: number) => ({ width, height });

  it('keeps every level of a 16-bit grey PNG', async () => {
    const image = await deepPng(4, 1, 0, [[0, ...wide(0, 1, 32768, 65535)]]);
    const { width, height, data } = await imageBrightness(image, asIs);
    expect([width, height]).toEqual([4, 1]);
    expect(data[0]).toBe(0);
    expect(data[1]).toBeCloseTo(1 / 65535, 9);
    expect(data[2]).toBeCloseTo(32768 / 65535, 7);
    expect(data[3]).toBe(1);
  });

  it('undoes the lines’ filters', async () => {
    // Sub: each byte less the one a pixel (2 bytes) before. Up: less the
    // one above.
    const first = wide(1000, 3000);
    const second = wide(1500, 2000);
    const image = await deepPng(2, 2, 0, [
      [1, first[0], first[1], first[2] - first[0], first[3] - first[1]],
      [2, ...second.map((b, i) => (b - first[i] + 256) % 256)],
    ]);
    const { data } = await imageBrightness(image, asIs);
    expect(Array.from(data, (v) => Math.round(v * 65535))).toEqual([
      1000, 3000, 1500, 2000,
    ]);
  });

  it('reads colour as luma, transparent as white', async () => {
    const image = await deepPng(2, 1, 6, [
      [0, ...wide(65535, 0, 0, 65535), ...wide(0, 0, 0, 0)],
    ]);
    const { data } = await imageBrightness(image, asIs);
    expect(data[0]).toBeCloseTo(0.299, 6);
    expect(data[1]).toBe(1);
  });

  it('scales to the size asked, each pixel the mean of what it covers', async () => {
    const image = await deepPng(4, 1, 0, [
      [0, ...wide(0, 65535, 65535, 65535)],
    ]);
    const { width, data } = await imageBrightness(image, () => ({
      width: 2,
      height: 1,
    }));
    expect(width).toBe(2);
    expect(data[0]).toBeCloseTo(0.5, 6);
    expect(data[1]).toBeCloseTo(1, 6);
  });
});
