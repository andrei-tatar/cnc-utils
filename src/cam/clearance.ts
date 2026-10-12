import {
  blankHeightmap,
  Heightmap,
  SimulatedStock,
  SimulatedTool,
  sweep,
  toolProfile,
} from './simulate';
import { CamPath, CamPoint3 } from './types';

/** A bit, as far as what it can hit goes. */
export type ClearanceTool = SimulatedTool & {
  /** How long its cutting edge is (mm); unset: not checked. */
  fluteLength?: number | null;
  /** How far it sticks out of the collet nut (mm); unset: not checked. */
  stickout?: number | null;
};

/**
 * Something an operation's moves run into, before or as it cuts:
 * - `rapid`: a rapid move (G0) into material not cut yet;
 * - `shank`: uncut material within the bit's reach rising above its
 *   flutes (the shank would rub) — `shankChecked` says which operations
 *   were looked at for this, so those that never did are known;
 * - `holder`: the collet nut coming down onto the material.
 */
export type ClearanceProblem = {
  operationId: string;
  kind: 'rapid' | 'shank' | 'holder';
  /** How far into the material, at worst (mm). */
  depth: number;
  /** Where that is. */
  at: CamPoint3;
  /** How many moves (rapids) or places (shank, holder) it happens at. */
  count: number;
};

export type ClearanceReport = {
  problems: ClearanceProblem[];
  /** Operations whose shank was looked at (they have a flute length). */
  shankChecked: string[];
};

/** Material this little above the bit doesn't count (mm). */
const TOLERANCE = 0.1;
/** The shank and the nut are looked at about this often along a cut (mm). */
const HOLDER_STEP = 2;

/**
 * Runs the job's moves in order over the stock (a heightmap of about
 * `maxCells`), cutting as it goes, and finds what they run into: rapids
 * into uncut material, the shank above the flutes and the collet nut
 * (`holderDiameter` across) on the material. Only for a job cut from above
 * as it lies (none of its paths turned or wrapped): otherwise nothing is
 * checked.
 */
export function checkClearances(
  paths: CamPath[],
  tools: Record<string, ClearanceTool>,
  stock: SimulatedStock,
  holderDiameter: number,
  maxCells = 250_000,
): ClearanceReport {
  const report: ClearanceReport = { problems: [], shankChecked: [] };
  if (paths.some((p) => p.rotation !== undefined || p.wrapped)) {
    return report;
  }
  const map = blankHeightmap(stock, maxCells);
  const found = new Map<string, ClearanceProblem>();
  const note = (
    operationId: string,
    kind: ClearanceProblem['kind'],
    depth: number,
    at: CamPoint3,
    newOne: boolean,
  ) => {
    const key = `${operationId}|${kind}`;
    const known = found.get(key);
    if (!known) {
      found.set(key, { operationId, kind, depth, at, count: 1 });
      return;
    }
    if (newOne) known.count++;
    if (depth > known.depth) {
      known.depth = depth;
      known.at = at;
    }
  };
  const shankChecked = new Set<string>();

  for (const path of paths) {
    const id = path.sourceOperationId ?? '';
    const tool = tools[id];
    const r = tool && tool.diameter > 0 ? tool.diameter / 2 : 0;
    const points = path.points;
    if (path.type === 'travel') {
      // The bit's end (its tip's shape: a drill's point goes back down into
      // its hole), kept a cell in from its edge: the walls it cut are
      // there, sampled a cell out.
      const reach = Math.max(0, r - 1.5 * map.cell);
      const shape = tool && r > 0 ? toolProfile(tool) : flat;
      for (let i = 1; i < points.length; i++) {
        const into = intoMaterial(map, points[i - 1], points[i], reach, shape);
        if (into) note(id, 'rapid', into.depth, into.at, true);
      }
      continue;
    }
    if (!tool || !(r > 0)) continue;
    const profile = toolProfile(tool);
    const flutes =
      tool.fluteLength && tool.fluteLength > 0 ? tool.fluteLength : 0;
    const stickout = tool.stickout && tool.stickout > 0 ? tool.stickout : 0;
    if (flutes) shankChecked.add(id);
    let since = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i > 0) {
        const q = points[i - 1];
        // Plunges count: the bit's deepest is at their bottom.
        since += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      }
      // Before this move cuts: what's there above the bit.
      if ((flutes || stickout) && since >= HOLDER_STEP) {
        since = 0;
        if (flutes) {
          const above = aboveBit(
            map,
            { ...p, z: p.z + flutes },
            Math.max(0, r - 1.5 * map.cell),
            flat,
          );
          if (above > TOLERANCE) note(id, 'shank', above, p, true);
        }
        if (stickout && holderDiameter > 0) {
          const above = aboveBit(
            map,
            { ...p, z: p.z + stickout },
            holderDiameter / 2,
            flat,
          );
          if (above > TOLERANCE) note(id, 'holder', above, p, true);
        }
      }
      if (i > 0) sweep(map, points[i - 1], p, r, profile);
    }
  }
  report.problems = [...found.values()];
  report.shankChecked = [...shankChecked];
  return report;
}

/** A flat end: what the shank and the nut are. */
const flat = () => 0;

/**
 * How far a rapid from `a` to `b` goes into the material, at worst, and
 * where; null when it stays clear. The bit's end is `shape` (how far its
 * surface is above its tip, out from its axis) out to `reach`.
 */
function intoMaterial(
  map: Heightmap,
  a: CamPoint3,
  b: CamPoint3,
  reach: number,
  shape: (d: number) => number,
): { depth: number; at: CamPoint3 } | null {
  // Above the stock: nothing to hit.
  if (Math.min(a.z, b.z) >= map.top - TOLERANCE) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(length / map.cell));
  let worst: { depth: number; at: CamPoint3 } | null = null;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const at = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const depth = aboveBit(map, at, reach, shape);
    if (depth > TOLERANCE && (!worst || depth > worst.depth)) {
      worst = { depth, at };
    }
  }
  return worst;
}

/**
 * How far the material rises above a bit end at `at` (its tip; `shape`
 * its surface out from the axis) within `radius` of its axis, at most:
 * negative when it's clear. Far out, cells are looked at about a
 * millimetre apart. Off the map there's nothing.
 */
function aboveBit(
  map: Heightmap,
  at: CamPoint3,
  radius: number,
  shape: (d: number) => number,
): number {
  const { cell, nx, ny, minX, minY, heights } = map;
  const ci = Math.floor((at.x - minX) / cell);
  const cj = Math.floor((at.y - minY) / cell);
  const reach = Math.floor(radius / cell);
  const stride = Math.max(1, Math.floor(1 / cell));
  let worst = -Infinity;
  for (const dj of offsets(reach, stride)) {
    const j = cj + dj;
    if (j < 0 || j >= ny) continue;
    const half = Math.floor(Math.sqrt(Math.max(0, reach * reach - dj * dj)));
    for (const di of offsets(half, stride)) {
      const i = ci + di;
      if (i < 0 || i >= nx) continue;
      // From the bit's axis to the cell's centre, as cutting measured it.
      const surface =
        at.z +
        shape(
          Math.hypot(
            minX + (i + 0.5) * cell - at.x,
            minY + (j + 0.5) * cell - at.y,
          ),
        );
      const above = heights[j * nx + i] - surface;
      if (above > worst) worst = above;
    }
  }
  return worst;
}

/** From −`reach` to `reach`, `stride` apart, both ends included. */
function offsets(reach: number, stride: number): number[] {
  const out: number[] = [];
  for (let d = -reach; d < reach; d += stride) out.push(d);
  out.push(reach);
  return out;
}
