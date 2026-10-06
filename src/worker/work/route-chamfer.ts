import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { enterCut } from '../../cam/ramp';
import { CamShape } from '../../cam/types';
import { getDistance } from '../../util';
import { inflate, orientContours, shapeRegion } from './regions';

export type ChamferOptions = {
  /** The V-bit. */
  toolSize: number;
  vAngle: number;
  tipDiameter: number;
  /** Width of the bevel, measured across the top (mm). */
  width: number;
  /**
   * `part`: the shape is the material, bevel its outline and holes.
   * `hole`: the shape is cut away (a pocket or hole), bevel its rim.
   */
  edges: 'part' | 'hole';
  /** How far below the bevel the tip goes, so it doesn't leave a step (mm). */
  extraDepth: number;
  /** Cut the bevel in this many passes, shallow to deep. */
  passes: number;
  direction: 'climb' | 'conventional';
  rampAngle?: number | null;
  geometry?: GeometrySettings;
};

/**
 * A bevel along the shape's edges with a V-bit. For a bevel `w` wide at
 * `α` (half the V angle) it reaches `h = w / tan α` down the wall; the tip
 * runs `extraDepth` below that, just outside the wall, so the cone's flank
 * lies on the bevel. Earlier passes keep the flank on the same line, higher
 * up.
 */
export async function routeChamfer(
  input: CamShape[],
  options: ChamferOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const tan = Math.tan(((options.vAngle / 2) * Math.PI) / 180);
  const tipRadius = Math.max(0, options.tipDiameter / 2);
  if (!(tan > 0) || !(options.width > 0)) {
    return builder;
  }
  // The bit can't cut deeper than its cone.
  const cone = Math.max(0, options.toolSize / 2 - tipRadius) / tan;
  const deepest = Math.min(
    cone,
    options.width / tan + Math.max(0, options.extraDepth),
  );
  const region = await shapeRegion(input);
  if (!region.length || !(deepest > 0)) {
    return builder;
  }
  // The material is on the cutter's right when climb milling.
  const materialOnRight = options.direction === 'climb';
  const outward = options.edges === 'part' ? 1 : -1;
  const passes = Math.max(1, Math.round(options.passes));

  let at = { x: 0, y: 0 };
  for (let k = 1; k <= passes; k++) {
    const depth = (deepest * k) / passes;
    // Where the tip runs: the flank meets the top `width` in from the edge.
    const offset = tipRadius + depth * tan - options.width;
    const path = await inflate(region, outward * offset);
    // `path` is the material grown (part) or the opening shrunk (hole).
    const loops = orientContours(path, materialOnRight === (outward === 1));
    for (const loop of nearestLoopsFirst(loops, at)) {
      builder.goToSafeHeight();
      const points = enterCut(
        builder,
        startNearest(loop, at),
        true,
        0,
        -depth,
        options.rampAngle ?? null,
        options.toolSize,
      );
      for (const p of points.slice(1)) {
        builder.carveTo(p.x, p.y, -depth);
      }
      builder.carveTo(points[0].x, points[0].y, -depth);
      at = points[0];
    }
  }
  builder.goToSafeHeight();
  return builder;
}

function nearestLoopsFirst(
  loops: { x: number; y: number }[][],
  start: { x: number; y: number },
) {
  const left = [...loops];
  const ordered = [];
  let at = start;
  while (left.length) {
    let best = 0;
    let bestDistance = Infinity;
    left.forEach((loop, i) => {
      const d = Math.min(...loop.map((p) => getDistance(at, p)));
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    const loop = left.splice(best, 1)[0];
    ordered.push(loop);
    at = loop[0];
  }
  return ordered;
}

/** The loop, starting at its point nearest `p`. */
function startNearest<T extends { x: number; y: number }>(
  loop: T[],
  p: T | { x: number; y: number },
) {
  let best = 0;
  loop.forEach((q, i) => {
    if (getDistance(p, q) < getDistance(p, loop[best])) best = i;
  });
  return [...loop.slice(best), ...loop.slice(0, best)];
}
