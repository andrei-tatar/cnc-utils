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
  /** The stock the pocket left on its walls. */
  previousLeaveStock?: number;
  toolEngagement: number;
  /** The stock this leaves on the walls, whatever the pocket left. */
  leaveStock: number;
  /** How far (mm) it cuts on into what the pocket cleared. */
  overlap?: number;
  startDepth: number;
  depthPerStep: number;
  steps: number;
  rampAngle?: number | null;
  geometry?: GeometrySettings;
  /** Pocket separate areas in the order that keeps travel short. */
  optimizeTravel?: boolean;
};

/**
 * Rest machining: pockets, with a smaller tool, only what a larger one left
 * in the pocket: corners tighter than its radius, gaps narrower than it.
 *
 * The larger tool swept the pocket's opening by its radius (less the stock
 * the pocket left); the smaller one can reach the opening by its own (less
 * its own leave stock, so leaving less than the pocket finishes the walls
 * too). Their difference is what's left, grown by the overlap into what the
 * pocket cleared; the smaller tool cuts the area its body sweeps reaching
 * it (which stays in the pocket), as an ordinary pocket.
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

  const region = await shapeRegion(input);
  const pocket = await inflate(region, -Math.max(0, options.leaveStock));
  const cleared = await reachable(
    await inflate(region, -Math.max(0, options.previousLeaveStock ?? 0)),
    previousRadius,
  );
  const reach = await reachable(pocket, radius);
  const left = await reachable(
    await combine(reach, cleared, 'difference'),
    SLIVER,
  );
  if (!left.length) {
    return new GCodeBuilder().sourceShapeId(sourceShapeId);
  }
  const overlap = Math.max(0, options.overlap ?? 0);
  const target =
    overlap > 0
      ? await combine(await inflate(left, overlap), reach, 'intersection')
      : left;
  // Where the smaller tool's centre goes to cut what's left, and what it
  // sweeps from there.
  const centers = await combine(
    await inflate(pocket, -radius),
    await inflate(target, radius),
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
    optimizeTravel: options.optimizeTravel,
  });
}
