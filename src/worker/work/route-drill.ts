import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { containingPolygons } from '../../cam/polygon-nesting';
import { isArea } from '../../cam/arcs';
import { CamPoint, CamShape } from '../../cam/types';
import { orderPoints } from '../../cam/travel-order';
import { centerOf } from './shape-transforms';

/** How far above the last peck's depth the bit comes back down quickly. */
const PECK_CLEARANCE = 0.3;
/** How far a chip-breaking peck lifts. */
const CHIP_BREAK_LIFT = 0.5;

export type DrillOptions = {
  /** `points`: single points only; `centers`: also each outline's centre. */
  drillAt: 'points' | 'centers';
  /** Where the material starts, below the surface (mm). */
  startDepth: number;
  /** How deep to drill from there (mm). */
  depth: number;
  /** Extra depth so the drill's full diameter reaches `depth` (its point). */
  pointLength: number;
  /** Depth per peck (mm), or 0 to drill in one go. */
  peck: number;
  /** Lift only a little between pecks (break the chip) instead of out. */
  chipBreak: boolean;
  /** Seconds to wait at the bottom. */
  dwell: number;
  /** Rapid down to this far above the material before drilling (mm). */
  retractHeight: number;
  /** Write canned cycles (G81/G82/G83/G73) instead of plain moves. */
  cycles: boolean;
  geometry?: GeometrySettings;
  /** Drill in the order that keeps travel short (default on). */
  optimizeTravel?: boolean;
};

/**
 * The places to drill, from the origin in the order that keeps travel short
 * (or in the shape's order).
 */
export function drillPositions(
  input: CamShape[],
  drillAt: DrillOptions['drillAt'],
  optimizeTravel = true,
): CamPoint[] {
  const polygons = input.flatMap((s) => s.polygons);
  const points: CamPoint[] = polygons
    .filter((p) => p.vertices.length === 1)
    .map((p) => ({ x: p.vertices[0].x, y: p.vertices[0].y }));
  if (drillAt === 'centers') {
    const closed = polygons.filter(isArea);
    const parents = containingPolygons(closed);
    closed.forEach((p, i) => {
      if (parents[i].length % 2 === 0) {
        points.push(centerOf(p));
      }
    });
  }
  return optimizeTravel ? orderPoints(points, { x: 0, y: 0 }) : points;
}

export async function routeDrill(
  input: CamShape[],
  options: DrillOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const top = -options.startDepth;
  const bottom =
    top - Math.max(0, options.depth) - Math.max(0, options.pointLength);
  const retract = top + Math.max(0, options.retractHeight);
  const peck = Math.max(0, options.peck);
  if (!(bottom < top)) {
    return builder;
  }

  builder.goToSafeHeight();
  for (const hole of drillPositions(
    input,
    options.drillAt,
    options.optimizeTravel,
  )) {
    if (options.cycles) {
      builder.drillCycle({
        x: hole.x,
        y: hole.y,
        depth: bottom,
        retract,
        peck,
        chipBreak: options.chipBreak,
        dwell: peck ? 0 : Math.max(0, options.dwell),
      });
      continue;
    }

    builder.travelTo(hole.x, hole.y);
    builder.rapidZ(retract);
    if (!peck) {
      builder.plunge(bottom);
    } else {
      let reached = top;
      while (reached > bottom + 1e-9) {
        const next = Math.max(bottom, reached - peck);
        if (reached < top && !options.chipBreak) {
          // Back down the hole drilled so far, to just above its bottom.
          builder.rapidZ(Math.min(retract, reached + PECK_CLEARANCE));
        }
        builder.plunge(next);
        reached = next;
        if (reached > bottom + 1e-9) {
          builder.rapidZ(
            options.chipBreak ? reached + CHIP_BREAK_LIFT : retract,
          );
        }
      }
    }
    if (options.dwell > 0) {
      builder.dwell(options.dwell);
    }
    builder.goToSafeHeight();
  }
  return builder;
}
