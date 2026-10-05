import { CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  insetContours,
  normalizedRegion,
  vCarveGeometry,
} from '../../cam/vcarve-geometry';
import { routePocketHole } from './route-pocket-hole';

/**
 * Extra margin from the V's walls on top of `leaveStock`: the pocket router
 * grows its input slightly and rounds coordinates, which would otherwise let
 * the end mill nick the walls by a few hundredths of a mm.
 */
const CLEARANCE = 0.05;

/**
 * Rough out a v-carve with an end mill, leaving only what the V-bit needs to
 * cut its sloped walls.
 *
 * At depth `h` the v-carve's walls sit `tipRadius + h * tan` inside the
 * outline, so the end mill can pocket that inset area (minus `leaveStock`)
 * at depth `h` without touching them. Stepping down by `depthPerStep`
 * pockets a shrinking area at each level: a staircase that stays inside the
 * V-groove. Above any level the walls are further out, so the end mill's
 * sides never cut into them either.
 */
export async function routeVCarveClearing(
  input: CamShape[],
  options: {
    /** The end mill. */
    toolSize: number;
    toolEngagement: number;
    depthPerStep: number;
    leaveStock: number;
    /** The v-carve being cleared for: its bit and settings. */
    vToolSize: number;
    vAngle: number;
    tipDiameter: number;
    startDepth: number;
    maxDepth: number;
  },
): Promise<GCodeBuilder> {
  const sourceShapeId = input?.[0]?.sourceShapeId;
  let builder = new GCodeBuilder().sourceShapeId(sourceShapeId);

  const geometry = vCarveGeometry({
    toolSize: options.vToolSize,
    vAngle: options.vAngle,
    tipDiameter: options.tipDiameter,
    maxDepth: options.maxDepth,
  });
  const step = options.depthPerStep;
  if (!geometry || !(step > 0) || !(options.toolSize > 0)) {
    return builder;
  }
  const { tan, tipRadius, maxDepth } = geometry;

  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.points.length > 2)
    .map((p) => p.points);
  if (!closed.length || maxDepth <= 0) {
    return builder;
  }
  const region = await normalizedRegion(closed);

  let previous = 0;
  while (previous < maxDepth - 1e-6) {
    const depth = Math.min(maxDepth, previous + step);
    const wallInset =
      tipRadius + depth * tan + Math.max(0, options.leaveStock) + CLEARANCE;

    // Deeper levels only shrink, so once the end mill no longer fits, no
    // deeper level can need it either.
    const reachable = await insetContours(
      region,
      wallInset + options.toolSize / 2,
    );
    if (!reachable.length) {
      break;
    }

    const area = await insetContours(region, wallInset);
    const level = await routePocketHole(
      [
        {
          sourceShapeId,
          polygons: area.map((points) => ({ points, close: true })),
        },
      ],
      {
        toolSize: options.toolSize,
        toolEngagement: options.toolEngagement,
        leaveStock: 0,
        // One pass, from the previous level down to this one.
        startDepth: options.startDepth + previous,
        depthPerStep: depth - previous,
        steps: 1,
      },
    );
    builder = builder.concat(level);
    previous = depth;
  }

  return builder;
}
