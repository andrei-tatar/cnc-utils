import type { PathsD } from 'clipper2-wasm/dist/clipper2z';
import {
  clipperBooleanOperation,
  clipperInflateRaw,
  makePaths,
} from './clipper';
import { CamPoint } from './types';
import { distanceToBoundary, pointInPolygon } from './polygon-nesting';
import { decimals, precision } from './geometry';

/**
 * Which part of a shape an operation (v-carve, profile) works on:
 * - `both`: the outlines and their holes
 * - `holes`: the same cuts, but only those coming from the holes, not from the
 *   outer outlines (where the two meet, halfway between them)
 * - `contours`: the outer outlines filled in, holes ignored
 */
export type ShapePart = 'both' | 'holes' | 'contours';

/**
 * How much further than its offset a point on a cut must be from the outer
 * outlines to count as coming from a hole, in precision steps (Clipper
 * rounds offsets).
 */
const HOLE_SIDE_TOLERANCE = 5;
// Irrelevant with round joins.
const MITER_LIMIT = 2;
const ARC_TOLERANCE = 0;

/**
 * The V-groove's shape for a given bit and settings: the walls at depth `h`
 * are `tipRadius + h * tan` inside the outline, down to `maxDepth`. Null for
 * an impossible angle.
 *
 * Normally the depth is also capped at the bit's cone height: below it the
 * straight shank would have to push through the uncut middle of the groove.
 * With `beyondCone` (the middle has been cleared by an end mill first) only
 * `maxDepth` applies: the cone face still lies along the wall at any depth,
 * and the shank stays inside the groove, clear of the wall.
 */
export function vCarveGeometry(options: {
  toolSize: number;
  vAngle: number;
  tipDiameter: number;
  maxDepth: number;
  beyondCone?: boolean;
}) {
  const tan = Math.tan(((options.vAngle / 2) * Math.PI) / 180);
  if (!(tan > 0) || !Number.isFinite(tan)) {
    return null;
  }
  const tipRadius = Math.max(0, options.tipDiameter / 2);
  // Past this depth the bit's full diameter is buried and the shank side
  // would start cutting the walls.
  const geometricMaxDepth = Math.max(
    0,
    (options.toolSize / 2 - tipRadius) / tan,
  );
  const maxDepth = options.beyondCone
    ? Math.max(0, options.maxDepth)
    : Math.min(options.maxDepth, geometricMaxDepth);
  return {
    tan,
    tipRadius,
    maxDepth,
    maxInset: tipRadius + maxDepth * tan,
    coneHeight: geometricMaxDepth,
  };
}

/**
 * The area a v-carve works in for `mode` (see ShapePart), as normalized
 * contours. "Holes only" works in the same area as "both" and picks its cuts
 * from there.
 */
export async function carveRegion(
  closed: CamPoint[][],
  mode: ShapePart = 'both',
): Promise<CamPoint[][]> {
  return mode === 'contours'
    ? filledOutlines(closed)
    : normalizedRegion(closed);
}

/** The holes in the shape (inside an outline, but not in the shape). */
export async function holeAreas(closed: CamPoint[][]): Promise<CamPoint[][]> {
  return subtractRegions(
    await filledOutlines(closed),
    await normalizedRegion(closed),
  );
}

/** The part of region `a` outside region `b`. */
export async function subtractRegions(
  a: CamPoint[][],
  b: CamPoint[][],
): Promise<CamPoint[][]> {
  const pa = await makePaths(a);
  const pb = await makePaths(b);
  const result = toPoints(
    await clipperBooleanOperation(pa, pb, 'difference', 'non-zero', decimals()),
  );
  pa.delete();
  pb.delete();
  return result;
}

/**
 * For "holes only": whether a point on a cut `offset` away from the shape's
 * nearest edge came from a hole, i.e. it is further than that from the outer
 * outlines. Where cuts from a hole meet cuts from an outline, that's halfway.
 */
export async function holeSide(closed: CamPoint[][]) {
  const outlines = await filledOutlines(closed);
  return (offset: number) => (p: CamPoint) =>
    distanceToBoundary(p, outlines) >
    Math.abs(offset) + HOLE_SIDE_TOLERANCE * precision();
}

/** Inside any outer outline (a path not nested in any other), holes ignored. */
export function filledOutlines(closed: CamPoint[][]): Promise<CamPoint[][]> {
  const outers = closed.filter(
    (contour, i) =>
      !closed.some((other, j) => j !== i && pointInPolygon(contour[0], other)),
  );
  return unionAll(outers);
}

/** Union of filled outlines, whatever their winding. */
async function unionAll(contours: CamPoint[][]): Promise<CamPoint[][]> {
  // Same winding for all, so overlapping outlines merge under non-zero.
  const oriented = contours.map((c) =>
    signedArea(c) < 0 ? [...c].reverse() : c,
  );
  const paths = await makePaths(oriented);
  const empty = await makePaths([]);
  const result = toPoints(
    await clipperBooleanOperation(
      paths,
      empty,
      'union',
      'non-zero',
      decimals(),
    ),
  );
  paths.delete();
  empty.delete();
  return result;
}

function signedArea(points: CamPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Union closed contours with even-odd filling, which normalizes winding so
 * holes (e.g. the counter of an "O") are recognized regardless of how the
 * source SVG oriented its subpaths.
 */
export async function normalizedRegion(
  closed: CamPoint[][],
): Promise<CamPoint[][]> {
  const raw = await makePaths(closed);
  const empty = await makePaths([]);
  const region = toPoints(
    await clipperBooleanOperation(raw, empty, 'union', 'even-odd', decimals()),
  );
  raw.delete();
  empty.delete();
  return region;
}

export async function insetContours(
  contours: CamPoint[][],
  inset: number,
): Promise<CamPoint[][]> {
  const paths = await makePaths(contours);
  // Round joins keep reflex corners exactly `inset` away from the outline;
  // convex corners stay sharp, which is what drives the bit into them.
  const inflated = await clipperInflateRaw(
    paths,
    -inset,
    'round',
    'polygon',
    MITER_LIMIT,
    decimals(),
    ARC_TOLERANCE,
  );
  paths.delete();

  return toPoints(inflated);
}

export function toPoints(paths: PathsD): CamPoint[][] {
  const result: CamPoint[][] = [];
  const pathsSize = paths.size();
  for (let i = 0; i < pathsSize; i++) {
    const path = paths.get(i);
    const points: CamPoint[] = [];
    const pathSize = path.size();
    for (let j = 0; j < pathSize; j++) {
      const point = path.get(j);
      points.push({ x: point.x, y: point.y });
    }
    if (points.length > 2) {
      result.push(points);
    }
  }
  paths.delete();

  return result;
}
