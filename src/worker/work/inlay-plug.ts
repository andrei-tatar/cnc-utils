import { CamShape } from '../../cam/types';
import { combine, regionShape, shapeRegion } from './regions';
import { getBoundingBox } from './shape-transforms';

/** How an inlay plug is made from the design it fills. */
export type InlayPlug = {
  /**
   * How far the carving reaches past the design at the surface: the plug's
   * start depth × tan(half the V angle). The plug's V-walls then start that
   * deep at the design's edge, matching the pocket's walls.
   */
  grow: number;
  /** Material left around the design, beyond its bounding box (mm). */
  margin: number;
};

/**
 * The area round an inlay plug: everything around the design (mirrored
 * left–right, as the plug is glued in face down) within its bounding box
 * plus `margin`. Carving it leaves the design standing as the plug.
 *
 * The carving reaches `grow` further, into the design, at the surface; but
 * the area isn't grown by it here: each level of the carving is the area
 * offset by `grow` less how far in that level is (`routeVCarve`,
 * `routeVCarveClearing`). Insetting the grown area instead would round the
 * design's corners off, more the deeper it goes, where the pocket keeps
 * them sharp, and the plug wouldn't fit.
 */
export async function inlayPlugShape(
  input: CamShape[],
  plug: InlayPlug,
): Promise<CamShape[]> {
  const sourceShapeId = input?.[0]?.sourceShapeId;
  const design = await shapeRegion(input);
  if (!design.length) return [];
  const box = getBoundingBox(regionShape(design, sourceShapeId));
  const middle = box.x + box.width / 2;
  const mirrored = design.map((contour) =>
    contour.map((p) => ({ x: 2 * middle - p.x, y: p.y })).reverse(),
  );
  const m = Math.max(0, plug.margin);
  const blank = [
    [
      { x: box.x - m, y: box.y - m },
      { x: box.x + box.width + m, y: box.y - m },
      { x: box.x + box.width + m, y: box.y + box.height + m },
      { x: box.x - m, y: box.y + box.height + m },
    ],
  ];
  return regionShape(
    await combine(blank, mirrored, 'difference'),
    sourceShapeId,
  );
}
