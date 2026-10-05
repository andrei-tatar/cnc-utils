import type { PathsD } from 'clipper2-wasm/dist/clipper2z';
import {
  clipperBooleanOperation,
  clipperInflateRaw,
  makePaths,
} from './clipper';
import { CamPoint } from './types';

export const PRECISION = 0.01;
// Clipper rounds coordinates to this many decimal places (= PRECISION).
export const DECIMALS = 2;
// Clipper2's native order is (miterLimit, decimals), the reverse of the
// clipperInflateRaw parameter names; both are 2 so either reading is correct.
// Miter limit is irrelevant with round joins anyway.
const MITER_LIMIT = 2;
const ARC_TOLERANCE = 0;

/**
 * The V-groove's shape for a given bit and settings: the walls at depth `h`
 * are `tipRadius + h * tan` inside the outline, down to `maxDepth`, which is
 * also capped so the bit's shank never touches the walls. Null for an
 * impossible angle.
 */
export function vCarveGeometry(options: {
  toolSize: number;
  vAngle: number;
  tipDiameter: number;
  maxDepth: number;
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
  const maxDepth = Math.min(options.maxDepth, geometricMaxDepth);
  return { tan, tipRadius, maxDepth, maxInset: tipRadius + maxDepth * tan };
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
    await clipperBooleanOperation(raw, empty, 'union', 'even-odd', DECIMALS),
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
    DECIMALS,
    MITER_LIMIT,
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
