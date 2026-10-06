import {
  clipperBooleanOperation,
  ClipperClipType,
  clipperInflateRaw,
  makePaths,
} from '../../cam/clipper';
import { decimals } from '../../cam/geometry';
import { containingContours, signedArea2 } from '../../cam/polygon-nesting';
import { CamPoint, CamShape } from '../../cam/types';
import { toPoints } from '../../cam/vcarve-geometry';

/**
 * Filled areas as closed contours (outlines and holes), worked on with
 * Clipper. Contours are taken by even-odd nesting, as pockets see them.
 */
export type Region = CamPoint[][];

/** The closed polygons of `input`, as one cleaned-up region. */
export function shapeRegion(input: CamShape[]): Promise<Region> {
  return regionOf(
    input
      .flatMap((s) => s.polygons)
      .filter((p) => p.close && p.points.length > 2)
      .map((p) => p.points),
  );
}

export async function regionOf(contours: CamPoint[][]): Promise<Region> {
  if (!contours.length) return [];
  const subject = await makePaths(contours);
  const none = await makePaths([]);
  const result = await clipperBooleanOperation(
    subject,
    none,
    'union',
    'even-odd',
    decimals(),
  );
  subject.delete();
  none.delete();
  return toPoints(result);
}

/** The region grown (or, negative, shrunk) by `delta` mm, rounding corners. */
export async function inflate(region: Region, delta: number): Promise<Region> {
  if (!region.length) return [];
  if (delta === 0) return region;
  const paths = await makePaths(region);
  const result = await clipperInflateRaw(
    paths,
    delta,
    'round',
    'polygon',
    2,
    decimals(),
    0,
  );
  paths.delete();
  return toPoints(result);
}

export async function combine(
  a: Region,
  b: Region,
  type: ClipperClipType,
): Promise<Region> {
  const subject = await makePaths(a);
  const clip = await makePaths(b);
  const result = await clipperBooleanOperation(
    subject,
    clip,
    type,
    'non-zero',
    decimals(),
  );
  subject.delete();
  clip.delete();
  return toPoints(result);
}

/** What a round tool of `radius` can reach of the region: an opening. */
export async function reachable(region: Region, radius: number) {
  return inflate(await inflate(region, -radius), radius);
}

/**
 * The region's contours, each turned so the filled side is on the right of
 * the direction of travel (or on the left).
 */
export function orientContours(region: Region, filledOnRight: boolean) {
  const parents = containingContours(region);
  return region.map((contour, i) => {
    const isHole = parents[i].length % 2 === 1;
    // Counter-clockwise has the inside on the left.
    const insideOnLeft = signedArea2(contour) > 0;
    const filledOnLeft = insideOnLeft !== isHole;
    return filledOnLeft === filledOnRight ? [...contour].reverse() : contour;
  });
}

export function regionShape(region: Region, sourceShapeId: string): CamShape[] {
  return region.length
    ? [
        {
          sourceShapeId,
          polygons: region.map((points) => ({ points, close: true })),
        },
      ]
    : [];
}
