import { InlayPlug, inlayPlugShape } from './inlay-plug';
import { CamPoint, CamShape } from '../../cam/types';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  insetContours,
  carveRegion,
  holeAreas,
  subtractRegions,
  ShapePart,
  vCarveGeometry,
} from '../../cam/vcarve-geometry';
import { routePocketHole } from './route-pocket-hole';
import { combine, sweptArea } from './regions';

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
    /** Null: no limit (clear down to the deepest point of the V). */
    maxDepth: number | null;
    /** The v-carve will go below its cone, so clear that deep too. */
    beyondCone?: boolean;
    /** The v-carve's mode: clear the same part of the shape. */
    mode?: ShapePart;
    /** Ramp down into each level at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
    /** Carve an inlay plug for the shape (see InlayPlug). */
    plug?: InlayPlug | null;
    /** How precisely to work (see GeometrySettings). */
    geometry?: GeometrySettings;
    /** Clear separate areas in the order that keeps travel short. */
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  // An inlay plug: carve around the (mirrored) design instead, reaching
  // `shift` further at the surface.
  let shift = 0;
  if (options.plug) {
    input = await inlayPlugShape(input, options.plug);
    shift = Math.max(0, options.plug.grow);
  }
  const sourceShapeId = input?.[0]?.sourceShapeId;
  let builder = new GCodeBuilder().sourceShapeId(sourceShapeId);

  const geometry = vCarveGeometry({
    toolSize: options.vToolSize,
    vAngle: options.vAngle,
    tipDiameter: options.tipDiameter,
    maxDepth: options.maxDepth,
    beyondCone: options.beyondCone,
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
  const region = await carveRegion(closed, options.mode);
  // "Around the holes only" cuts no V-walls along the outer outlines, so the
  // clearing goes right up to them: the filled outlines, kept clear of the
  // walls the V-bit cuts from the holes.
  const holes = options.mode === 'holes' ? await holeAreas(closed) : null;
  const outlines = holes ? await carveRegion(closed, 'contours') : null;
  if (holes && !holes.length) {
    return builder;
  }

  let previous = 0;
  while (previous < maxDepth - 1e-6) {
    const depth = Math.min(maxDepth, previous + step);
    const wallInset =
      tipRadius + depth * tan + Math.max(0, options.leaveStock) + CLEARANCE;

    const area =
      holes && outlines
        ? await subtractRegions(
            outlines,
            await insetContours(holes, -wallInset),
          )
        : await insetContours(region, wallInset - shift);

    // Deeper levels only shrink, so once the end mill no longer fits, no
    // deeper level can need it either.
    const reachable = await insetContours(area, options.toolSize / 2);
    if (!reachable.length) {
      break;
    }

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
        rampAngle: options.rampAngle,
        optimizeTravel: options.optimizeTravel,
      },
    );
    builder = builder.concat(level);
    previous = depth;
  }

  return builder;
}

/** An end mill clearing for a v-carve: the clearing's own settings. */
export type ClearingTool = {
  toolSize: number;
  toolEngagement: number;
  depthPerStep: number;
  leaveStock: number;
  rampAngle: number | null;
};

/**
 * What clearings for a v-carve leave cleared at its max depth: where their
 * end mills sweep on their deepest level, routed as routeVCarveClearing
 * routes them (an end mill that fits somewhere doesn't always get there).
 * `input` and `vcarve` are the v-carve's shape and settings, before any
 * plug.
 */
export async function clearedAtMaxDepth(
  input: CamShape[],
  vcarve: {
    toolSize: number;
    vAngle: number;
    tipDiameter: number;
    startDepth: number;
    maxDepth: number | null;
    beyondCone?: boolean;
    mode?: ShapePart;
    plug?: InlayPlug | null;
    geometry?: GeometrySettings;
    optimizeTravel?: boolean;
  },
  clearings: ClearingTool[],
): Promise<CamPoint[][]> {
  const geometry = vCarveGeometry(vcarve);
  if (!geometry) {
    return [];
  }
  const bottom = -(vcarve.startDepth + geometry.maxDepth);
  let cleared: CamPoint[][] = [];
  for (const clearing of clearings) {
    const routed = await routeVCarveClearing(input, {
      ...clearing,
      vToolSize: vcarve.toolSize,
      vAngle: vcarve.vAngle,
      tipDiameter: vcarve.tipDiameter,
      startDepth: vcarve.startDepth,
      maxDepth: vcarve.maxDepth,
      beyondCone: vcarve.beyondCone,
      mode: vcarve.mode,
      plug: vcarve.plug,
      geometry: vcarve.geometry,
      optimizeTravel: vcarve.optimizeTravel,
    });
    // The runs of cuts at the bottom (ramps down to it don't count).
    const runs: CamPoint[][] = [];
    for (const path of routed.toPaths()) {
      let run: CamPoint[] = [];
      for (const p of path.type === 'carve' ? path.points : []) {
        if (Math.abs(p.z - bottom) < 1e-4) {
          run.push(p);
        } else {
          if (run.length) runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
    }
    const swept = await sweptArea(runs, clearing.toolSize / 2);
    cleared = cleared.length ? await combine(cleared, swept, 'union') : swept;
  }
  return cleared;
}
