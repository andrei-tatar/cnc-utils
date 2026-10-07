import { CamPoint, CamPolygon, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  decimals,
  GeometrySettings,
  precision,
  useGeometry,
} from '../../cam/geometry';
import { ShapePart, filledOutlines, holeSide } from '../../cam/vcarve-geometry';
import { enterCut, Resume } from '../../cam/ramp';
import { applyTransform } from './apply-transform';
import { getDistance } from '../../util';
import { insideFirst, TravelStop, travelOrder } from '../../cam/travel-order';

export async function routeProfile(
  input: CamShape[],
  options: {
    toolSize: number;
    side: 'outside' | 'inside' | 'on-line';
    direction: 'climb' | 'conventional';
    /** Keeps the cut this much further from the material (mm). */
    leaveStock?: number;
    startDepth: number;
    depthPerStep: number;
    steps: number;
    /** Which part of the shape to profile. */
    mode?: ShapePart;
    /** Ramp down into each pass at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
    /** How precisely to work (see GeometrySettings). */
    geometry?: GeometrySettings;
    /** Cut the paths in the order that keeps travel short (default on). */
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  const sourceShapeId = input?.[0]?.sourceShapeId;
  builder.sourceShapeId(sourceShapeId);

  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.points.length > 2)
    .map((p) => p.points);
  if (options.mode === 'contours') {
    // Holes ignored: profile the filled outer outlines (and any open paths).
    const open = input.flatMap((s) => s.polygons).filter((p) => !p.close);
    const filled = (await filledOutlines(closed)).map((points): CamPolygon => ({
      points,
      close: true,
    }));
    input = [{ sourceShapeId, polygons: [...filled, ...open] }];
  }

  // Offset the outline by half the tool diameter so the cutting edge lands on
  // the shape boundary, plus any stock left on the wall. 'on-line' rides the
  // path itself (no compensation, no material side to leave stock on).
  const clearance = options.toolSize / 2 + Math.max(0, options.leaveStock ?? 0);
  const offset =
    options.side === 'outside'
      ? clearance
      : options.side === 'inside'
        ? -clearance
        : 0;

  const offsetInput =
    offset === 0
      ? input
      : await applyTransform(input, {
          type: 'clipper-inflate',
          offset,
          endType: 'polygon',
          joinType: 'round',
          // The offset transform's fields reach Clipper swapped (see
          // applyTransform): miter limit 2, the settings' decimal places.
          precision: 2,
          miterLimit: decimals(),
          arcTolerance: 0,
        });

  // "Holes only" makes the same cuts as both, but keeps just the parts that
  // come from holes (open paths aren't holes).
  const keep =
    options.mode === 'holes' && closed.length
      ? (await holeSide(closed))(offset)
      : null;

  const polygons = offsetInput
    .flatMap((s) => s.polygons)
    .filter(
      (p) => p.points.length >= 2 && (options.mode !== 'holes' || p.close),
    )
    .flatMap((p) =>
      // Orient first, so pieces of a loop keep its direction.
      keptStretches(
        {
          ...p,
          points: orientPath(
            p.points,
            p.close,
            options.side,
            options.direction,
          ),
        },
        keep,
      ),
    );

  const ordered =
    options.optimizeTravel === false
      ? polygons
      : travelOrdered(polygons, {
          ...options,
          // Open paths from loops keep their direction.
          reversible: options.mode !== 'holes',
        });

  for (const polygon of ordered) {
    let points = polygon.points;
    // When ramping, each pass carries on from where the one before ended,
    // without lifting: round a loop, or back along an open path.
    let resume: Resume | undefined;

    for (let step = 0; step < options.steps; step++) {
      const depth = -(options.startDepth + options.depthPerStep * (step + 1));

      // Each pass starts where the previous one left off.
      const from = -(options.startDepth + options.depthPerStep * step);
      const cut = carvePass(
        builder,
        points,
        polygon.close,
        from,
        depth,
        { ...options, rampAngle: options.rampAngle ?? null },
        resume,
      );
      if (options.rampAngle) {
        if (polygon.close) {
          points = cut;
        } else {
          // Open paths end at the far end: go back the other way.
          points = [...cut].reverse();
        }
        resume = { point: points[0], down: true };
      }
    }
  }

  return builder;
}

/**
 * The paths in the order that keeps the travel between them short, those
 * inside a loop before it (so a part stays held until it's cut free). Loops
 * start at their point nearest the tool; open paths may be cut either way
 * round when `reversible`.
 */
function travelOrdered(
  polygons: CamPolygon[],
  options: {
    reversible: boolean;
    steps: number;
    rampAngle?: number | null;
  },
): CamPolygon[] {
  const after = insideFirst(polygons);
  // Ramped passes along an open path go back and forth: after an even
  // number of them the tool is back at the start.
  const endsWhereStarted = !!options.rampAngle && options.steps % 2 === 0;
  const stops = polygons.map(({ points, close }, i): TravelStop => {
    if (close) {
      return { starts: points, after: after[i] };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const starts = options.reversible ? [first, last] : [first];
    return {
      starts,
      end: (start) =>
        endsWhereStarted ? starts[start] : (starts[1 - start] ?? last),
      after: after[i],
    };
  });
  return travelOrder(stops, { x: 0, y: 0 }).map(({ index, start }) => {
    const { points, close } = polygons[index];
    if (!start) {
      return polygons[index];
    }
    return {
      close,
      points: close
        ? [...points.slice(start), ...points.slice(0, start)]
        : [...points].reverse(),
    };
  });
}

/**
 * The parts of `polygon` where `keep` holds, as open paths that start and end
 * where it stops holding (the whole polygon when it holds everywhere).
 */
function keptStretches(
  polygon: CamPolygon,
  keep: ((p: CamPoint) => boolean) | null,
): CamPolygon[] {
  const { points, close } = polygon;
  const kept = points.map((p) => !keep || keep(p));
  if (kept.every(Boolean)) {
    return [polygon];
  }
  if (!kept.some(Boolean)) {
    return [];
  }
  const n = points.length;
  // Loops start where a kept stretch begins.
  const first = close
    ? kept.findIndex((k, i) => k && !kept[(i - 1 + n) % n])
    : 0;

  // How far the edge from kept `a` towards dropped `b` stays kept.
  const lastKept = (a: CamPoint, b: CamPoint) => {
    const at = (t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * getDistance(a, b) > precision()) {
      const mid = (lo + hi) / 2;
      if (keep!(at(mid))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return at(lo);
  };

  const order = close
    ? [...Array(n).keys()].map((i) => (first + i) % n)
    : [...Array(n).keys()];
  const stretches: CamPolygon[] = [];
  // A loop's first stretch starts where the edge into it comes back in.
  let current: CamPoint[] | null = close
    ? [lastKept(points[first], points[(first - 1 + n) % n])]
    : null;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const hasNext = close || k < order.length - 1;
    const j = close ? order[(k + 1) % n] : order[k + 1];
    if (kept[i]) {
      current ??= [];
      current.push(points[i]);
      if (hasNext && !kept[j]) {
        current.push(lastKept(points[i], points[j]));
      }
    } else if (hasNext && kept[j] && k < order.length - 1) {
      // (The edge back into the first stretch was handled at the start.)
      current = [lastKept(points[j], points[i])];
    }
    if (current && (!hasNext || !kept[j])) {
      if (current.length > 1) {
        stretches.push({ points: current, close: false });
      }
      current = null;
    }
  }
  return stretches;
}

/**
 * Normalize the travel direction. Climb milling keeps the material on a
 * consistent side of the cutter: clockwise around an outside profile,
 * counter-clockwise around an inside one (and the reverse for conventional).
 * Only closed loops have a meaningful winding.
 */
function orientPath(
  points: CamPoint[],
  close: boolean,
  side: 'outside' | 'inside' | 'on-line',
  direction: 'climb' | 'conventional',
): CamPoint[] {
  if (!close) {
    return points;
  }

  const wantCounterClockwise =
    direction === 'climb' ? side === 'inside' : side !== 'inside';

  const isCounterClockwise = signedArea(points) > 0;
  return isCounterClockwise === wantCounterClockwise
    ? points
    : [...points].reverse();
}

/** One pass along `points` at `depth`; returns the path as it was cut. */
function carvePass(
  builder: GCodeBuilder,
  points: CamPoint[],
  close: boolean,
  from: number,
  depth: number,
  options: { rampAngle: number | null; toolSize: number },
  resume?: Resume,
): CamPoint[] {
  if (!resume?.down) {
    builder.goToSafeHeight();
  }
  points = enterCut(
    builder,
    points,
    close,
    from,
    depth,
    options.rampAngle,
    options.toolSize,
    Infinity,
    resume,
  );
  // Vertices the tool visits in order; a closed loop returns to its start.
  const loop = close ? [...points, points[0]] : points;
  for (let i = 1; i < loop.length; i++) {
    builder.carveTo(loop[i].x, loop[i].y);
  }
  return points;
}

function signedArea(points: CamPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
