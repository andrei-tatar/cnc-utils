import { CamPoint, CamPolygon } from './types';
import { booleanOperation, normalize, offsetRegion } from './kernel';
import { distanceToPolygons, reversePolygon, signedArea } from './arcs';
import { containingPolygons } from './polygon-nesting';
import { precision } from './geometry';

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
 * outlines to count as coming from a hole, in precision steps (where an
 * offset meets an outline's own, they're the same distance away).
 */
const HOLE_SIDE_TOLERANCE = 5;

/**
 * The V-groove's shape for a given bit and settings: the walls at depth `h`
 * are `tipRadius + h * tan` inside the outline, down to `maxDepth` (null: as
 * deep as the shape's width takes it, a pointed V everywhere). Null for an
 * impossible angle.
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
  maxDepth: number | null;
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
  const limit = options.maxDepth ?? Infinity;
  const maxDepth = options.beyondCone
    ? Math.max(0, limit)
    : Math.min(limit, geometricMaxDepth);
  return {
    tan,
    tipRadius,
    maxDepth,
    maxInset: tipRadius + maxDepth * tan,
    coneHeight: geometricMaxDepth,
  };
}

/**
 * The area a v-carve works in for `mode` (see ShapePart), as a clean
 * region. "Holes only" works in the same area as "both" and picks its cuts
 * from there.
 */
export async function carveRegion(
  closed: CamPolygon[],
  mode: ShapePart = 'both',
): Promise<CamPolygon[]> {
  return mode === 'contours'
    ? filledOutlines(closed)
    : normalizedRegion(closed);
}

/** The holes in the shape (inside an outline, but not in the shape). */
export async function holeAreas(closed: CamPolygon[]): Promise<CamPolygon[]> {
  return subtractRegions(
    await filledOutlines(closed),
    await normalizedRegion(closed),
  );
}

/** The part of region `a` outside region `b`. */
export function subtractRegions(
  a: CamPolygon[],
  b: CamPolygon[],
): Promise<CamPolygon[]> {
  return booleanOperation(a, b, 'difference', 'non-zero');
}

/**
 * For "holes only": whether a point on a cut `offset` away from the shape's
 * nearest edge came from a hole, i.e. it is further than that from the outer
 * outlines. Where cuts from a hole meet cuts from an outline, that's halfway.
 */
export async function holeSide(closed: CamPolygon[]) {
  const outlines = await filledOutlines(closed);
  return (offset: number) => (p: CamPoint) =>
    distanceToPolygons(p, outlines) >
    Math.abs(offset) + HOLE_SIDE_TOLERANCE * precision();
}

/** Inside any outer outline (a polygon not nested in any other), holes ignored. */
export function filledOutlines(closed: CamPolygon[]): Promise<CamPolygon[]> {
  const parents = containingPolygons(closed);
  const outers = closed.filter((_, i) => !parents[i].length);
  // Same winding for all, so overlapping outlines merge under non-zero.
  return normalize(
    outers.map((p) => (signedArea(p) < 0 ? reversePolygon(p) : p)),
    'non-zero',
  );
}

/**
 * Closed polygons as a clean region under even-odd filling, so holes (e.g.
 * the counter of an "O") are recognized whatever way the source oriented
 * them.
 */
export function normalizedRegion(closed: CamPolygon[]): Promise<CamPolygon[]> {
  return normalize(closed, 'even-odd');
}

/**
 * A clean region shrunk by `inset` (grown when negative). Round joins keep
 * reflex corners exactly `inset` away from the outline; convex corners stay
 * sharp, which is what drives the bit into them.
 */
export function insetContours(
  region: CamPolygon[],
  inset: number,
): Promise<CamPolygon[]> {
  return offsetRegion(region, -inset);
}
