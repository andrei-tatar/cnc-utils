import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import {
  combine,
  inflate,
  reachable,
  regionShape,
  shapeRegion,
} from './regions';
import { routePocketHole } from './route-pocket-hole';

/** Leftovers thinner than this (mm) are rounding noise along the walls. */
const SLIVER = 0.02;

export type RestOptions = {
  /** The smaller tool, doing the rest. */
  toolSize: number;
  /** The tool the pocket was cleared with first. */
  previousToolSize: number;
  toolEngagement: number;
  leaveStock: number;
  startDepth: number;
  depthPerStep: number;
  steps: number;
  rampAngle?: number | null;
  geometry?: GeometrySettings;
};

/**
 * Rest machining: pockets, with a smaller tool, only what a larger one left
 * in the pocket: corners tighter than its radius, gaps narrower than it.
 *
 * The larger tool swept the pocket's opening by its radius; the smaller one
 * can reach the opening by its own. Their difference is what's left; the
 * smaller tool cuts the area its body sweeps reaching it (which stays in the
 * pocket), as an ordinary pocket.
 */
export async function routeRest(
  input: CamShape[],
  options: RestOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const sourceShapeId = input?.[0]?.sourceShapeId;
  const radius = options.toolSize / 2;
  const previousRadius = options.previousToolSize / 2;
  if (!(radius > 0) || !(previousRadius > radius)) {
    return new GCodeBuilder().sourceShapeId(sourceShapeId);
  }

  const pocket = await inflate(
    await shapeRegion(input),
    -Math.max(0, options.leaveStock),
  );
  const cleared = await reachable(pocket, previousRadius);
  const reach = await reachable(pocket, radius);
  const left = await reachable(
    await combine(reach, cleared, 'difference'),
    SLIVER,
  );
  if (!left.length) {
    return new GCodeBuilder().sourceShapeId(sourceShapeId);
  }
  // Where the smaller tool's centre goes to cut what's left, and what it
  // sweeps from there.
  const centers = await combine(
    await inflate(pocket, -radius),
    await inflate(left, radius),
    'intersection',
  );
  const swept = await inflate(centers, radius);

  return routePocketHole(regionShape(swept, sourceShapeId), {
    toolSize: options.toolSize,
    toolEngagement: options.toolEngagement,
    leaveStock: 0,
    startDepth: options.startDepth,
    depthPerStep: options.depthPerStep,
    steps: options.steps,
    strategy: 'offset',
    rampAngle: options.rampAngle,
    geometry: options.geometry,
  });
}
