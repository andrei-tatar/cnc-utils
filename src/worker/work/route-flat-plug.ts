import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import { reversePolygon, transformPolygon } from '../../cam/arcs';
import { inflate, reachable, regionShape, shapeRegion } from './regions';
import { getBoundingBox } from './shape-transforms';
import { routeProfile } from './route-profile';

/**
 * The outline of a flat-bottomed inlay's plug: the area a pocket's end mill
 * of `pocketToolSize` really clears in `input` (its corners rounded to the
 * bit), shrunk by `gap` all round, and mirrored left–right when asked.
 */
export async function flatPlugShape(
  input: CamShape[],
  options: { pocketToolSize: number; gap: number; mirror: boolean },
): Promise<CamShape[]> {
  const sourceShapeId = input?.[0]?.sourceShapeId;
  const design = await shapeRegion(input);
  if (!design.length) return [];
  const pocket = await reachable(
    design,
    Math.max(0, options.pocketToolSize) / 2,
  );
  let plug = await inflate(pocket, -Math.max(0, options.gap));
  if (options.mirror && plug.length) {
    const box = getBoundingBox(regionShape(plug, sourceShapeId));
    const middle = box.x + box.width / 2;
    plug = plug.map((contour) =>
      reversePolygon(transformPolygon(contour, [-1, 0, 0, 1, 2 * middle, 0])),
    );
  }
  return regionShape(plug, sourceShapeId);
}

/** Cuts out a flat inlay's plug: an outside profile round its outline. */
export async function routeFlatPlug(
  input: CamShape[],
  options: {
    pocketToolSize: number;
    gap: number;
    mirror: boolean;
    toolSize: number;
    direction: 'climb' | 'conventional';
    startDepth: number;
    depthPerStep: number;
    steps: number;
    rampAngle?: number | null;
    geometry?: GeometrySettings;
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const plug = await flatPlugShape(input, options);
  if (!plug.length) {
    return new GCodeBuilder();
  }
  return routeProfile(plug, {
    toolSize: options.toolSize,
    side: 'outside',
    direction: options.direction,
    startDepth: options.startDepth,
    depthPerStep: options.depthPerStep,
    steps: options.steps,
    mode: 'both',
    rampAngle: options.rampAngle,
    geometry: options.geometry,
    optimizeTravel: options.optimizeTravel,
  });
}
