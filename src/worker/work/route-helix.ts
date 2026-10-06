import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import { containingContours } from '../../cam/polygon-nesting';
import { CamPoint, CamShape } from '../../cam/types';
import { nearestFirst } from './route-drill';
import { centerOf } from './shape-transforms';

export type HelixOptions = {
  toolSize: number;
  /** Where the material starts, below the surface (mm). */
  startDepth: number;
  /** How deep to bore from there (mm). */
  depth: number;
  /** Depth per turn of the helix (mm). */
  pitch: number;
  direction: 'climb' | 'conventional';
  /** Left on the hole's wall (mm). */
  leaveStock: number;
  /**
   * For holes wider than twice the tool: bore rings from the middle out, so
   * no core is left standing.
   */
  clearMiddle: boolean;
  /** Ring spacing, as a fraction of the tool diameter. */
  toolEngagement: number;
  geometry?: GeometrySettings;
};

/** How far (mm) a round hole's points may be off a circle, plus 1 %. */
const ROUNDNESS = 0.05;

/** A hole to bore: its centre and radius. */
export type Bore = { center: CamPoint; radius: number };

/**
 * The round holes in the shape: each outline (not its holes) whose points
 * are all about the same distance from its centre. Anything else (a
 * square, a slot) would be cut past its sides by a round bore, so it's left
 * out. Single points can't be bored.
 */
export function boreHoles(input: CamShape[]): Bore[] {
  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.points.length > 2);
  const parents = containingContours(closed.map((p) => p.points));
  return closed
    .filter((_, i) => parents[i].length % 2 === 0)
    .flatMap((p) => {
      const center = centerOf(p.points, true);
      // Corners and the middles of the sides: a square's corners alone are
      // all as far from its centre.
      const distances = p.points.flatMap((q, i) => {
        const r = p.points[(i + 1) % p.points.length];
        return [
          Math.hypot(q.x - center.x, q.y - center.y),
          Math.hypot((q.x + r.x) / 2 - center.x, (q.y + r.y) / 2 - center.y),
        ];
      });
      const radius = Math.min(...distances);
      const round =
        Math.max(...distances) - radius <= ROUNDNESS + radius * 0.01;
      return round ? [{ center, radius }] : [];
    });
}

/**
 * Helical boring: the tool spirals down round each round hole (much easier
 * on it than plunging), then goes round once more at the bottom to leave it
 * flat.
 */
export async function routeHelix(
  input: CamShape[],
  options: HelixOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const toolRadius = options.toolSize / 2;
  const top = -options.startDepth;
  const bottom = top - Math.max(0, options.depth);
  const pitch = Math.max(0.01, options.pitch);
  if (!(bottom < top) || !(toolRadius > 0)) {
    return builder;
  }
  // Climb milling inside a hole (spindle turning clockwise) goes
  // counter-clockwise.
  const turn = options.direction === 'climb' ? 1 : -1;
  const stepover =
    options.toolSize * Math.min(1, Math.max(0.05, options.toolEngagement));

  const bores = boreHoles(input);
  const centers = nearestFirst(
    bores.map((b) => b.center),
    { x: 0, y: 0 },
  );
  for (const center of centers) {
    const bore = bores.find((b) => b.center === center)!;
    const outer = bore.radius - toolRadius - Math.max(0, options.leaveStock);
    if (outer < -1e-9) {
      continue; // smaller than the tool
    }
    // A ring of radius ρ cuts from ρ - r to ρ + r: rings `stepover` apart
    // until one reaches the middle (ρ ≤ r), bored from the middle out so
    // each ring only takes `stepover` more.
    const rings: number[] = [Math.max(0, outer)];
    if (options.clearMiddle) {
      while (rings[0] > toolRadius) {
        const next = rings[0] - stepover;
        // Never quite to the middle: a tiny helix instead of a plunge.
        rings.unshift(next > 0 ? next : Math.min(stepover, rings[0]) / 2);
      }
    }

    builder.goToSafeHeight();
    for (const [k, radius] of rings.entries()) {
      if (k > 0) {
        // Up out of the bore, over to the next ring.
        builder.rapidZ(top + 1);
      }
      if (radius < 1e-6) {
        builder.travelTo(center.x, center.y);
        builder.plunge(bottom);
        continue;
      }
      builder.travelTo(center.x + radius, center.y);
      builder.plunge(top);
      helix(builder, center, radius, top, bottom, pitch, turn);
    }
    builder.goToSafeHeight();
  }
  return builder;
}

/**
 * Round and down from `top` to `bottom` at `pitch` per turn, starting and
 * ending at angle 0, then once round flat at the bottom.
 */
function helix(
  builder: GCodeBuilder,
  center: CamPoint,
  radius: number,
  top: number,
  bottom: number,
  pitch: number,
  turn: 1 | -1,
) {
  const tolerance = curveTolerance();
  const perTurn = Math.max(
    8,
    Math.ceil(
      (2 * Math.PI) /
        (radius > tolerance
          ? Math.min(Math.PI / 4, 2 * Math.acos(1 - tolerance / radius))
          : Math.PI / 2),
    ),
  );
  const turns = Math.max(1, Math.ceil((top - bottom) / pitch));
  const steps = turns * perTurn;
  for (let i = 1; i <= steps + perTurn; i++) {
    const a = (turn * 2 * Math.PI * i) / perTurn;
    const z = i <= steps ? top - ((top - bottom) * i) / steps : bottom;
    builder.carveTo(
      center.x + radius * Math.cos(a),
      center.y + radius * Math.sin(a),
      z,
    );
  }
}
