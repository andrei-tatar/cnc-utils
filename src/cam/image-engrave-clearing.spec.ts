import {
  clearableLoops,
  clearingLevels,
  lowestReach,
  maxOverDisk,
} from './image-engrave-clearing';
import { Heightmap } from './simulate';

describe('image engraving clearing', () => {
  it('steps down to the deepest, the last level there', () => {
    expect(clearingLevels(2.5, 1)).toEqual([1, 2, 2.5]);
    expect(clearingLevels(2, 1)).toEqual([1, 2]);
    expect(clearingLevels(0, 1)).toEqual([]);
  });

  /** A 20 × 20 mm map, 0.5 mm cells, with a 10 × 10 mm hole 3 deep. */
  const surface = (): Heightmap => {
    const nx = 40;
    const ny = 40;
    const heights = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const inside = i >= 10 && i < 30 && j >= 10 && j < 30;
        heights[j * nx + i] = inside ? -3 : 0;
      }
    }
    return {
      minX: 0,
      minY: 0,
      cell: 0.5,
      nx,
      ny,
      heights,
      top: 0,
      bottom: -10,
    };
  };

  it('outlines where the surface is deep enough', () => {
    const loops = clearableLoops(surface(), -2, 0.5);
    expect(loops.length).toBe(1);
    const xs = loops[0].map((p) => p.x);
    const ys = loops[0].map((p) => p.y);
    // The hole's cells run from 5 to 15 mm; the outline lies between the
    // last cell centre inside and the first outside.
    for (const v of [Math.min(...xs), Math.min(...ys)]) {
      expect(v).toBeGreaterThan(4.75 - 1e-9);
      expect(v).toBeLessThan(5.25 + 1e-9);
    }
    for (const v of [Math.max(...xs), Math.max(...ys)]) {
      expect(v).toBeGreaterThan(14.75 - 1e-9);
      expect(v).toBeLessThan(15.25 + 1e-9);
    }
  });

  it('outlines nothing where what must be left reaches the level', () => {
    expect(clearableLoops(surface(), -2.6, 0.5)).toEqual([]);
  });

  it('takes the highest value within the disk', () => {
    const nx = 23;
    const ny = 17;
    const values = new Float32Array(nx * ny);
    let seed = 7;
    for (let i = 0; i < values.length; i++) {
      seed = (seed * 16807) % 2147483647;
      values[i] = (seed % 1000) / 100;
    }
    const reach = 4;
    const result = maxOverDisk(values, nx, ny, reach);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let expected = -Infinity;
        for (let dj = -reach; dj <= reach; dj++) {
          for (let di = -reach; di <= reach; di++) {
            const x = i + di;
            const y = j + dj;
            if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
            if (di * di + dj * dj > reach * reach) continue;
            expected = Math.max(expected, values[y * nx + x]);
          }
        }
        expect(result[j * nx + i]).toBe(expected);
      }
    }
  });

  it('reaches only as deep as the bit fits', () => {
    // Grooves 3 deep every other column, ridges 1 deep between: a bit
    // wider than a groove rests on the ridges.
    const nx = 40;
    const ny = 40;
    const heights = new Float32Array(nx * ny).map((_, k) => (k % 2 ? -3 : -1));
    const map: Heightmap = {
      minX: 0,
      minY: 0,
      cell: 0.5,
      nx,
      ny,
      heights,
      top: 0,
      bottom: -10,
    };
    expect(lowestReach(map, 1)).toBe(-1);
    expect(lowestReach(surface(), 1)).toBe(-3);
  });
});
