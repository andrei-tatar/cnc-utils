import { meshBounds, meshHeights, parseStl } from './stl';

/** A binary STL of `triangles` (nine numbers each). */
export function binaryStl(triangles: number[]): ArrayBuffer {
  const count = triangles.length / 9;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) {
      view.setFloat32(84 + t * 50 + 12 + k * 4, triangles[t * 9 + k], true);
    }
  }
  return buffer;
}

/** A square pyramid 20 × 20, 10 high, its base on Z 0 (sides only). */
export const PYRAMID = [
  [0, 0, 0, 20, 0, 0],
  [20, 0, 0, 20, 20, 0],
  [20, 20, 0, 0, 20, 0],
  [0, 20, 0, 0, 0, 0],
].flatMap((edge) => [...edge, 10, 10, 10]);

describe('parseStl', () => {
  it('reads a binary file', () => {
    const triangles = parseStl(binaryStl(PYRAMID));
    expect(triangles.length).toBe(36);
    expect(Array.from(triangles.slice(0, 9))).toEqual([
      0, 0, 0, 20, 0, 0, 10, 10, 10,
    ]);
  });

  it('reads an ASCII file', () => {
    const text = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1.5 0 0
      vertex 0 2e1 -3
    endloop
  endfacet
endsolid test`;
    const triangles = parseStl(new TextEncoder().encode(text).buffer);
    expect(Array.from(triangles)).toEqual([0, 0, 0, 1.5, 0, 0, 0, 20, -3]);
  });

  it('refuses a file with no triangles', () => {
    expect(() =>
      parseStl(new TextEncoder().encode('not a model').buffer),
    ).toThrowError(/No triangles/);
  });
});

describe('meshHeights', () => {
  it('sees the mesh from above, 0 at its lowest and 1 at its highest', () => {
    const triangles = Float32Array.from(PYRAMID);
    expect(meshBounds(triangles)).toEqual({
      minX: 0,
      maxX: 20,
      minY: 0,
      maxY: 20,
      minZ: 0,
      maxZ: 10,
    });
    const { data } = meshHeights(triangles, 20, 20);
    // Cell (i, j) centre at (i + 0.5, 19.5 − j): the pyramid's height there
    // over its own.
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        const x = i + 0.5;
        const y = 19.5 - j;
        const expected = 1 - Math.max(Math.abs(x - 10), Math.abs(y - 10)) / 10;
        expect(data[j * 20 + i]).toBeCloseTo(expected, 5);
      }
    }
  });

  it('leaves cells it doesn’t cover without a height', () => {
    // One triangle over the lower-left half.
    const { data } = meshHeights(
      Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      10,
      10,
    );
    // The bottom-left cell has one (a flat mesh is all at its highest), the
    // top-right not.
    expect(data[9 * 10]).toBe(1);
    expect(data[9]).toBeNaN();
  });
});
