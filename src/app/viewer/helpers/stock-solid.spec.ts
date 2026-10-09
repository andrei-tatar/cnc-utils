import type { Heightmap } from '../../../cam/simulate';
import { edgeLoop, stockSolid } from './stock-solid';

describe('stockSolid', () => {
  const colors = {
    top: { r: 1, g: 1, b: 1 },
    floor: { r: 0, g: 0, b: 0 },
    side: { r: 0.5, g: 0.5, b: 0.5 },
  };
  const heightmap = (nx: number, ny: number, heights: number[]): Heightmap => ({
    minX: 0,
    minY: 0,
    cell: 1,
    nx,
    ny,
    heights: Float32Array.from(heights),
    top: 0,
    bottom: -10,
  });
  const triangles = (index: Uint32Array) => index.length / 3;
  /** The normal of each triangle (not normalised). */
  const normals = ({ positions, index }: ReturnType<typeof stockSolid>) => {
    const p = (v: number) => [0, 1, 2].map((c) => positions[v * 3 + c]);
    const result: number[][] = [];
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [p(index[t]), p(index[t + 1]), p(index[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      result.push([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
    }
    return result;
  };

  it('walks the edge of the grid anticlockwise', () => {
    expect(edgeLoop(3, 3)).toEqual([0, 1, 2, 5, 8, 7, 6, 3]);
    expect(edgeLoop(1, 3)).toEqual([]);
  });

  it('closes an uncut block: top, bottom and four walls facing out', () => {
    const solid = stockSolid(heightmap(3, 3, Array(9).fill(0)), colors);
    // 4 squares × 2 triangles, top and bottom, and 8 wall segments × 2.
    expect(triangles(solid.index)).toBe(16 + 16);
    const faces = normals(solid);
    expect(faces.slice(0, 16).filter((n) => n[2] > 0).length).toBe(8);
    expect(faces.slice(0, 16).filter((n) => n[2] < 0).length).toBe(8);
    // The walls face away from the middle (1, 1).
    for (let t = 16; t < faces.length; t++) {
      const v = solid.index[t * 3];
      const out = [solid.positions[v * 3] - 1, solid.positions[v * 3 + 1] - 1];
      expect(faces[t][0] * out[0] + faces[t][1] * out[1]).toBeGreaterThan(0);
      expect(faces[t][2]).toBeCloseTo(0);
    }
  });

  it('leaves a hole where the cuts go through', () => {
    const heights = Array(16).fill(0);
    for (const k of [5, 6, 9, 10]) heights[k] = -10;
    const solid = stockSolid(heightmap(4, 4, heights), colors);
    // 9 squares less the middle one, top and bottom; 12 wall segments.
    expect(triangles(solid.index)).toBe(8 * 4 + 12 * 2);
  });

  it('shades the top darker where it is cut deeper, the sides plain', () => {
    const solid = stockSolid(heightmap(2, 2, [0, -5, -10, 0]), colors);
    expect(solid.colors[0]).toBe(1);
    expect(solid.colors[3]).toBeCloseTo(0.5);
    expect(solid.colors[6]).toBe(0);
    // The bottom grid.
    expect(solid.colors[4 * 3]).toBe(0.5);
  });

  it('colours the cuts along a depth ramp, the deepest at its end', () => {
    const ramp = [
      { r: 1, g: 0, b: 0 },
      { r: 0, g: 0, b: 1 },
    ];
    // Cut 2 and 4 deep into a 10 thick block: 4 is the deepest there is.
    const solid = stockSolid(heightmap(3, 1, [0, -2, -4]), {
      ...colors,
      depthRamp: ramp,
    });
    const color = (v: number) =>
      Array.from(solid.colors.subarray(v * 3, v * 3 + 3)).map(
        (c) => Math.round(c * 100) / 100,
      );
    expect(color(0)).toEqual([1, 1, 1]); // uncut: the top's colour
    expect(color(1)).toEqual([0.5, 0, 0.5]); // half as deep
    expect(color(2)).toEqual([0, 0, 1]); // the deepest
  });
});
