import { insideTester } from './arcs';
import { CamPoint, CamPolygon } from './types';

/** Points closer than this (mm) are the same point. */
const SAME_POINT = 1e-6;

/**
 * What a shape covers, for combining shapes: its region (clean closed
 * loops) and its single points (drill points), which belong to it wherever
 * they are.
 */
export type PointSet = {
  region: CamPolygon[];
  points: CamPoint[];
};

export type PointSetOperation = 'union' | 'difference' | 'intersection' | 'xor';

/** A shape's single points (polygons of one vertex), each once. */
export function singlePoints(polygons: CamPolygon[]): CamPoint[] {
  return distinctPoints(
    polygons
      .filter((p) => p.vertices.length === 1)
      .map((p) => ({ x: p.vertices[0].x, y: p.vertices[0].y })),
  );
}

/** Points as the single-point polygons shapes hold them as. */
export function pointPolygons(points: CamPoint[]): CamPolygon[] {
  return points.map((p) => ({ vertices: [{ x: p.x, y: p.y }], close: false }));
}

/**
 * The points left when `a` is combined with `b` (the regions are combined
 * by the kernel): a point counts as in the other shape when it's one of its
 * points or lies in its region.
 *
 * - union: the points of both;
 * - difference: `a`'s points that aren't in `b`;
 * - intersection: each one's points that are in the other;
 * - xor: each one's points that aren't in the other.
 */
export function combinePoints(
  a: PointSet,
  b: PointSet,
  operation: PointSetOperation,
): CamPoint[] {
  if (!a.points.length && !b.points.length) {
    return [];
  }
  if (operation === 'union') {
    return distinctPoints([...a.points, ...b.points]);
  }
  const inA = membership(a);
  const inB = membership(b);
  switch (operation) {
    case 'difference':
      return a.points.filter((p) => !inB(p));
    case 'intersection':
      return distinctPoints([...a.points.filter(inB), ...b.points.filter(inA)]);
    case 'xor':
      return [
        ...a.points.filter((p) => !inB(p)),
        ...b.points.filter((p) => !inA(p)),
      ];
  }
}

function membership(set: PointSet): (p: CamPoint) => boolean {
  const inside = insideTester(set.region);
  const isPoint = pointFinder(set.points);
  return (p) => isPoint(p) || inside(p);
}

/** Cell of a grid `SAME_POINT` wide, to find points near one another. */
const cell = (v: number) => Math.round(v / SAME_POINT);

/** Whether a point is (within `SAME_POINT`) one of `points`. */
function pointFinder(points: CamPoint[]): (p: CamPoint) => boolean {
  const cells = new Map<string, CamPoint[]>();
  for (const p of points) {
    const key = `${cell(p.x)},${cell(p.y)}`;
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  return (p) => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const near = cells.get(`${cx + dx},${cy + dy}`);
        if (near?.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= SAME_POINT)) {
          return true;
        }
      }
    }
    return false;
  };
}

/** The points in order, leaving out those already there. */
function distinctPoints(points: CamPoint[]): CamPoint[] {
  const cells = new Map<string, CamPoint[]>();
  const out: CamPoint[] = [];
  for (const p of points) {
    const cx = cell(p.x);
    const cy = cell(p.y);
    let seen = false;
    for (let dx = -1; dx <= 1 && !seen; dx++) {
      for (let dy = -1; dy <= 1 && !seen; dy++) {
        seen = !!cells
          .get(`${cx + dx},${cy + dy}`)
          ?.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= SAME_POINT);
      }
    }
    if (seen) continue;
    out.push(p);
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  return out;
}
