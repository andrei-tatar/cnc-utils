import type { Heightmap } from '../../../cam/simulate';

/** A colour as three.js keeps it (linear components, 0 – 1). */
export type Rgb = { r: number; g: number; b: number };

/** The colours of the simulated block. */
export type StockColors = {
  /** The uncut top. */
  top: Rgb;
  /** The top where it's cut down to the bottom (in between, a blend). */
  floor: Rgb;
  /** The sides and the bottom. */
  side: Rgb;
};

/** An indexed triangle mesh, ready for a `BufferGeometry`. */
export type SolidMesh = {
  positions: Float32Array;
  colors: Float32Array;
  index: Uint32Array;
};

/** Closer than this to the bottom (mm), the material is cut through. */
const THROUGH = 1e-3;

/**
 * The material left as a closed solid: the heightmap's surface on top, the
 * stock's bottom under it and walls round the edge. Where the cuts go right
 * through, there's a hole: a grid square whose four corners are all cut
 * through has neither top nor bottom. The grid's points are the cells'
 * centres.
 */
export function stockSolid(map: Heightmap, colors: StockColors): SolidMesh {
  const { nx, ny, cell, minX, minY, heights, top, bottom } = map;
  const count = nx * ny;
  // Top and bottom grids, then the walls' own points (so their normals
  // aren't averaged with the top's): the edge loop, once up and once down.
  const loop = edgeLoop(nx, ny);
  const vertices = 2 * count + 2 * loop.length;
  const positions = new Float32Array(vertices * 3);
  const vertexColors = new Float32Array(vertices * 3);
  const depth = Math.min(-1e-6, bottom - top);
  const set = (v: number, x: number, y: number, z: number, c: Rgb) => {
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    vertexColors[v * 3] = c.r;
    vertexColors[v * 3 + 1] = c.g;
    vertexColors[v * 3 + 2] = c.b;
  };
  const shade = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < ny; j++) {
    const y = minY + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = minX + (i + 0.5) * cell;
      const z = heights[k];
      const t = Math.min(1, Math.max(0, (z - top) / depth));
      shade.r = colors.top.r + (colors.floor.r - colors.top.r) * t;
      shade.g = colors.top.g + (colors.floor.g - colors.top.g) * t;
      shade.b = colors.top.b + (colors.floor.b - colors.top.b) * t;
      set(k, x, y, z, shade);
      set(count + k, x, y, bottom, colors.side);
    }
  }
  const wall = 2 * count;
  loop.forEach((k, n) => {
    const x = positions[k * 3];
    const y = positions[k * 3 + 1];
    set(wall + 2 * n, x, y, heights[k], colors.side);
    set(wall + 2 * n + 1, x, y, bottom, colors.side);
  });

  const through = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    through[k] = heights[k] <= bottom + THROUGH ? 1 : 0;
  }
  const quads = (nx - 1) * (ny - 1);
  const index = new Uint32Array(quads * 12 + loop.length * 6);
  let n = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      if (through[a] && through[b] && through[c] && through[d]) continue;
      // Top facing up, bottom facing down.
      index.set([a, b, d, b, c, d], n);
      index.set([count + a, count + d, count + b], n + 6);
      index.set([count + b, count + d, count + c], n + 9);
      n += 12;
    }
  }
  // The loop runs anticlockwise seen from above, so the walls face out.
  for (let m = 0; m < loop.length; m++) {
    const up = wall + 2 * m;
    const next = wall + 2 * ((m + 1) % loop.length);
    index.set([up + 1, next + 1, next, up + 1, next, up], n);
    n += 6;
  }
  return { positions, colors: vertexColors, index: index.subarray(0, n) };
}

/** The grid's edge points, anticlockwise seen from above (+Z). */
export function edgeLoop(nx: number, ny: number): number[] {
  if (nx < 2 || ny < 2) return [];
  const loop: number[] = [];
  for (let i = 0; i < nx - 1; i++) loop.push(i);
  for (let j = 0; j < ny - 1; j++) loop.push(j * nx + nx - 1);
  for (let i = nx - 1; i > 0; i--) loop.push((ny - 1) * nx + i);
  for (let j = ny - 1; j > 0; j--) loop.push(j * nx);
  return loop;
}
