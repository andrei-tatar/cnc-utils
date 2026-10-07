import {
  BooleanOp,
  booleanOperation,
  inflatePaths,
  normalize,
  offsetRegion,
} from '../../cam/kernel';
import { reversePolygon, signedArea, windingNumber } from '../../cam/arcs';
import { CamPolygon, CamShape } from '../../cam/types';

/**
 * Filled areas as closed polygons of lines and arcs (outlines and holes),
 * worked on with the geometry kernel. What the kernel returns is clean:
 * outlines counter-clockwise, holes clockwise, none crossing another.
 */
export type Region = CamPolygon[];

/** The closed polygons of `input`, as one clean region (even-odd). */
export function shapeRegion(input: CamShape[]): Promise<Region> {
  return regionOf(
    input
      .flatMap((s) => s.polygons)
      .filter((p) => p.close && p.vertices.length > 1),
  );
}

/** Closed polygons as a clean region, nested ones taken as holes. */
export async function regionOf(polygons: CamPolygon[]): Promise<Region> {
  if (!polygons.length) return [];
  return normalize(polygons, 'even-odd');
}

/**
 * The region grown (or, negative, shrunk) by `delta` mm, rounding corners:
 * every point of the result exactly `|delta|` from the region's edge.
 */
export async function inflate(region: Region, delta: number): Promise<Region> {
  if (!region.length) return [];
  return offsetRegion(region, delta);
}

export async function combine(
  a: Region,
  b: Region,
  type: BooleanOp,
): Promise<Region> {
  return booleanOperation(a, b, type, 'non-zero');
}

/** What a round tool of `radius` can reach of the region: an opening. */
export async function reachable(region: Region, radius: number) {
  return inflate(await inflate(region, -radius), radius);
}

/** What a round tool of `radius` cuts moving along `lines` (open paths). */
export async function sweptArea(
  lines: CamPolygon[],
  radius: number,
): Promise<Region> {
  if (!lines.length || !(radius > 0)) return [];
  return inflatePaths(
    lines.map((l) => ({ ...l, close: false })),
    radius,
    'round',
    'round',
  );
}

/**
 * The region's contours, each turned so the filled side is on the right of
 * the direction of travel (or on the left): a contour nested in an odd
 * number of others is a hole.
 */
export function orientContours(region: Region, filledOnRight: boolean) {
  return region.map((polygon, i) => {
    const probe = polygon.vertices[0];
    const depth = region.filter(
      (other, j) => j !== i && windingNumber(probe, [other]) !== 0,
    ).length;
    const isHole = depth % 2 === 1;
    // Counter-clockwise has the inside on the left.
    const insideOnLeft = signedArea(polygon) > 0;
    const filledOnLeft = insideOnLeft !== isHole;
    return filledOnLeft === filledOnRight ? reversePolygon(polygon) : polygon;
  });
}

export function regionShape(region: Region, sourceShapeId: string): CamShape[] {
  return region.length ? [{ sourceShapeId, polygons: region }] : [];
}
