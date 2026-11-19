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
  /** Tapered ball nose: the radius of the ball at its tip (mm). */
  tipRadius?: number;
  /** Tapered ball nose: how far its side leans off the axis (degrees). */
  taperAngle?: number;
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
  const map = blankHeightmap(stock, maxCells);
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
  floorAt(map, stock.bottom);
  return map;
}

/** `stock` uncut, on about `maxCells` square cells. */
export function blankHeightmap(
  stock: SimulatedStock,
  maxCells = 400_000,
): Heightmap {
  const width = Math.max(stock.maxX - stock.minX, 1e-6);
  const height = Math.max(stock.maxY - stock.minY, 1e-6);
  const cell = Math.max(MIN_CELL, Math.sqrt((width * height) / maxCells));
  const nx = Math.max(1, Math.ceil(width / cell));
  const ny = Math.max(1, Math.ceil(height / cell));
  return {
    minX: stock.minX,
    minY: stock.minY,
    cell,
    nx,
    ny,
    heights: new Float32Array(nx * ny).fill(stock.top),
    top: stock.top,
    bottom: stock.bottom,
  };
}

/** Nothing below `bottom`: the stock ends there. */
function floorAt(map: Heightmap, bottom: number) {
  const { heights } = map;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < bottom) heights[i] = bottom;
  }
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
    case 'tapered-ball-nose': {
      const { ball, reach, height, tan } = taperedBallNose(tool);
      return (d) =>
        d <= reach
          ? ball - Math.sqrt(Math.max(0, ball * ball - d * d))
          : height + (d - reach) / tan;
    }
    default:
      return () => 0;
  }
}

/**
 * A tapered ball nose's shape: the radius of its ball (`ball`, never wider
 * than the bit), how far from the axis (`reach`) and how high above the tip
 * (`height`) the ball ends and the straight side starts — where they're
 * tangent —, the tangent of the side's angle off the axis (`tan`), and how
 * high above the tip the side reaches the bit's full diameter (`top`).
 */
export function taperedBallNose(
  tool: Pick<SimulatedTool, 'diameter' | 'tipRadius' | 'taperAngle'>,
) {
  const r = Math.max(0, tool.diameter / 2);
  const ball = Math.min(Math.max(0, tool.tipRadius ?? 0), r);
  const angle =
    (Math.min(Math.max(tool.taperAngle ?? 0, 0), 89) * Math.PI) / 180;
  const tan = Math.max(Math.tan(angle), 1e-6);
  // Never past the bit's side: a ball as wide as the bit is a ball nose.
  const reach = Math.min(ball * Math.cos(angle), r);
  const height = ball - Math.sqrt(Math.max(0, ball * ball - reach * reach));
  return { ball, reach, height, tan, top: height + (r - reach) / tan };
}

/** Lowers the material where the bit passes from `a` to `b`. */
export function sweep(
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
      // Straight up or down, the bit is lowest at the bottom of the move.
      let t =
        lengthSq > 0
          ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSq
          : dz < 0
            ? 1
            : 0;
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
