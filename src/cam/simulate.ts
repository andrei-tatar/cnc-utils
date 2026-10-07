import { CamPath, CamPoint3 } from './types';

/** The shape of a bit, as far as what it leaves in the material goes. */
export type SimulatedTool = {
  bitType: string;
  diameter: number;
  /** V-bit: the angle of its V (degrees). */
  vAngle?: number;
  /** V-bit: how wide its tip is (mm). */
  tipDiameter?: number;
  /** Bull nose: the radius of its corners (mm). */
  cornerRadius?: number;
  /** Drill: the angle of its point (degrees). */
  pointAngle?: number;
};

/** The block of material to cut into, in design coordinates. */
export type SimulatedStock = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Z of its top (0) and its bottom. */
  top: number;
  bottom: number;
};

/** The material left: its height on a grid of square cells. */
export type Heightmap = {
  minX: number;
  minY: number;
  /** Size of a cell (mm). */
  cell: number;
  /** Cells along X and Y. */
  nx: number;
  ny: number;
  /** Row by row from minY, `nx` per row: the top of the material there. */
  heights: Float32Array;
  top: number;
  bottom: number;
};

/** Never finer than this (mm). */
const MIN_CELL = 0.1;

/**
 * What's left of `stock` once every cut of `paths` is made: each cut sweeps
 * its operation's bit (`tools`, by operation id) along the move, and the
 * material ends up at the lowest the bit's tip shape reached over each cell.
 * Travel moves don't cut. Keeps to about `maxCells` cells.
 */
export function simulateStock(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  stock: SimulatedStock,
  maxCells = 400_000,
): Heightmap {
  const width = Math.max(stock.maxX - stock.minX, 1e-6);
  const height = Math.max(stock.maxY - stock.minY, 1e-6);
  const cell = Math.max(MIN_CELL, Math.sqrt((width * height) / maxCells));
  const nx = Math.max(1, Math.ceil(width / cell));
  const ny = Math.max(1, Math.ceil(height / cell));
  const heights = new Float32Array(nx * ny).fill(stock.top);
  const map: Heightmap = {
    minX: stock.minX,
    minY: stock.minY,
    cell,
    nx,
    ny,
    heights,
    top: stock.top,
    bottom: stock.bottom,
  };

  for (const path of paths) {
    if (path.type !== 'carve' || !path.sourceOperationId) continue;
    const tool = tools[path.sourceOperationId];
    if (!tool || !(tool.diameter > 0)) continue;
    const profile = toolProfile(tool);
    const points = path.points;
    for (let i = 1; i < points.length; i++) {
      sweep(map, points[i - 1], points[i], tool.diameter / 2, profile);
    }
  }

  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < stock.bottom) heights[i] = stock.bottom;
  }
  return map;
}

/** How far above the tip the bit's surface is, `d` from its axis. */
export function toolProfile(tool: SimulatedTool): (d: number) => number {
  const r = tool.diameter / 2;
  switch (tool.bitType) {
    case 'ball-nose':
      return (d) => r - Math.sqrt(Math.max(0, r * r - d * d));
    case 'bull-nose': {
      const rc = Math.min(Math.max(0, tool.cornerRadius ?? 0), r);
      const flat = r - rc;
      return (d) =>
        d <= flat
          ? 0
          : rc - Math.sqrt(Math.max(0, rc * rc - (d - flat) * (d - flat)));
    }
    case 'v-bit': {
      const tip = Math.max(0, tool.tipDiameter ?? 0) / 2;
      const tan = Math.tan((((tool.vAngle ?? 90) / 2) * Math.PI) / 180);
      return (d) => (d <= tip ? 0 : (d - tip) / Math.max(tan, 1e-6));
    }
    case 'drill': {
      const tan = Math.tan((((tool.pointAngle ?? 118) / 2) * Math.PI) / 180);
      return (d) => d / Math.max(tan, 1e-6);
    }
    default:
      return () => 0;
  }
}

/** Lowers the material where the bit passes from `a` to `b`. */
function sweep(
  map: Heightmap,
  a: CamPoint3,
  b: CamPoint3,
  r: number,
  profile: (d: number) => number,
) {
  // Nothing to cut above the material.
  if (Math.min(a.z, b.z) >= map.top) return;
  const { cell, nx, ny, minX, minY, heights } = map;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - minX) / cell));
  const i1 = Math.min(
    nx - 1,
    Math.floor((Math.max(a.x, b.x) + r - minX) / cell),
  );
  const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - minY) / cell));
  const j1 = Math.min(
    ny - 1,
    Math.floor((Math.max(a.y, b.y) + r - minY) / cell),
  );
  if (i0 > i1 || j0 > j1) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dy * dy;
  const r2 = r * r;
  for (let j = j0; j <= j1; j++) {
    const y = minY + (j + 0.5) * cell;
    const row = j * nx;
    for (let i = i0; i <= i1; i++) {
      const x = minX + (i + 0.5) * cell;
      let t = lengthSq > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + dx * t - x;
      const py = a.y + dy * t - y;
      const d2 = px * px + py * py;
      if (d2 > r2) continue;
      const z = a.z + dz * t + profile(Math.sqrt(d2));
      if (z < heights[row + i]) heights[row + i] = z;
    }
  }
}
