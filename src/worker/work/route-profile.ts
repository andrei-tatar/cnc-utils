import { CamPoint, CamPolygon, CamShape, CamVertex } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, precision, useGeometry } from '../../cam/geometry';
import { ShapePart, filledOutlines, holeSide } from '../../cam/vcarve-geometry';
import { enterCut, Resume } from '../../cam/ramp';
import { applyTransform } from './apply-transform';
import { getDistance } from '../../util';
import { insideFirst, TravelStop, travelOrder } from '../../cam/travel-order';
import { withLeads } from '../../cam/leads';
import {
  bulgeOf,
  pointAlong,
  reversePolygon,
  segmentLength,
  signedArea,
  sweepOf,
} from '../../cam/arcs';

export async function routeProfile(
  input: CamShape[],
  options: {
    toolSize: number;
    side: 'outside' | 'inside' | 'on-line';
    direction: 'climb' | 'conventional';
    /** Keeps the cut this much further from the material (mm). */
    leaveStock?: number;
    /** One more pass at full depth on the line, taking off `leaveStock`. */
    finishPass?: boolean;
    /** Stop this much above full depth; a last pass cuts through it (mm). */
    onionSkin?: number;
    /** Radius of an arc into and out of each loop, on the waste side (mm). */
    leadIn?: number;
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
    .filter((p) => p.close && p.vertices.length > 1);
  if (options.mode === 'contours') {
    // Holes ignored: profile the filled outer outlines (and any open paths).
    const open = input.flatMap((s) => s.polygons).filter((p) => !p.close);
    const filled = await filledOutlines(closed);
    input = [{ sourceShapeId, polygons: [...filled, ...open] }];
  }

  const leaveStock = Math.max(0, options.leaveStock ?? 0);
  const total = options.depthPerStep * options.steps;
  const skin = Math.min(Math.max(0, options.onionSkin ?? 0), total);
  // 'On line' has no wall to leave stock on.
  const finish =
    !!options.finishPass && leaveStock > 0 && options.side !== 'on-line';
  const top = -options.startDepth;
  const bottom = top - total;
  const roughBottom = bottom + skin;

  const paths = (stock: number) =>
    profilePaths(input, closed, { ...options, leaveStock: stock });
  const leads = (options.leadIn ?? 0) > 0 && options.side !== 'on-line';

  // The passes down, each stopping at the onion skin.
  const rough = await paths(leaveStock);
  const levels: number[] = [];
  for (let step = 0; step < options.steps; step++) {
    const depth = Math.max(
      top - options.depthPerStep * (step + 1),
      roughBottom,
    );
    if (depth < (levels[levels.length - 1] ?? top) - 1e-9) {
      levels.push(depth);
    }
  }
  for (const polygon of rough) {
    cutPasses(builder, polygon, top, levels, options, leads);
  }

  // Once every path is cut down to the skin: through it (on the line itself
  // when finishing), at full depth in one pass. Above the skin the passes
  // cleared all but the stock left on the wall, so it starts down there.
  if (skin > 0 || finish) {
    const last = finish ? await paths(0) : rough;
    for (const polygon of last) {
      cutPasses(builder, polygon, roughBottom, [bottom], options, leads);
    }
  }

  return builder;
}

/** The paths to profile `input` on, oriented and in the order to cut them. */
async function profilePaths(
  input: CamShape[],
  closed: CamPolygon[],
  options: {
    toolSize: number;
    side: 'outside' | 'inside' | 'on-line';
    direction: 'climb' | 'conventional';
    leaveStock: number;
    mode?: ShapePart;
    steps: number;
    rampAngle?: number | null;
    optimizeTravel?: boolean;
  },
): Promise<CamPolygon[]> {
  // Offset the outline by half the tool diameter so the cutting edge lands on
  // the shape boundary, plus any stock left on the wall. 'on-line' rides the
  // path itself (no compensation, no material side to leave stock on).
  const clearance = options.toolSize / 2 + options.leaveStock;
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
          type: 'offset',
          offset,
          endType: 'polygon',
          joinType: 'round',
          miterLimit: 2,
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
      (p) => p.vertices.length >= 2 && (options.mode !== 'holes' || p.close),
    )
    .flatMap((p) =>
      // Orient first, so pieces of a loop keep its direction.
      keptStretches(orientPath(p, options.side, options.direction), keep),
    );

  return options.optimizeTravel === false
    ? polygons
    : travelOrdered(polygons, {
        ...options,
        // Open paths from loops keep their direction.
        reversible: options.mode !== 'holes',
      });
}

/**
 * The passes along one path, from Z `from` down to each of `levels` in turn.
 * With lead-ins, a loop becomes an open path that arcs in from the waste side
 * and out again, cut the same way round every pass (lifting between them).
 */
function cutPasses(
  builder: GCodeBuilder,
  polygon: CamPolygon,
  from: number,
  levels: number[],
  options: {
    side: 'outside' | 'inside' | 'on-line';
    toolSize: number;
    leadIn?: number;
    rampAngle?: number | null;
  },
  leads: boolean,
) {
  const rampAngle = options.rampAngle ?? null;
  if (leads && polygon.close && polygon.vertices.length > 1) {
    const path = withLeads(polygon.vertices, options.side, options.leadIn!);
    let level = from;
    for (const depth of levels) {
      carvePass(builder, path, false, level, depth, {
        rampAngle,
        toolSize: options.toolSize,
      });
      level = depth;
    }
    return;
  }

  let points = polygon.vertices;
  // When ramping, each pass carries on from where the one before ended,
  // without lifting: round a loop, or back along an open path.
  let resume: Resume | undefined;
  let level = from;
  for (const depth of levels) {
    const cut = carvePass(
      builder,
      points,
      polygon.close,
      level,
      depth,
      { rampAngle, toolSize: options.toolSize },
      resume,
    );
    if (rampAngle) {
      // Open paths end at the far end: go back the other way.
      points = polygon.close
        ? cut
        : reversePolygon({ vertices: cut, close: false }).vertices;
      resume = { point: points[0], down: true };
    }
    level = depth;
  }
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
  const stops = polygons.map(({ vertices, close }, i): TravelStop => {
    if (close) {
      return { starts: vertices, after: after[i] };
    }
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    const starts = options.reversible ? [first, last] : [first];
    return {
      starts,
      end: (start) =>
        endsWhereStarted ? starts[start] : (starts[1 - start] ?? last),
      after: after[i],
    };
  });
  return travelOrder(stops, { x: 0, y: 0 }).map(({ index, start }) => {
    const polygon = polygons[index];
    if (!start) {
      return polygon;
    }
    const { vertices, close } = polygon;
    return close
      ? {
          close,
          vertices: [...vertices.slice(start), ...vertices.slice(0, start)],
        }
      : reversePolygon(polygon);
  });
}

/**
 * The parts of `polygon` where `keep` holds, as open paths that start and end
 * where it stops holding (the whole polygon when it holds everywhere).
 * Tested at the vertices; where it changes between two, the edge is split
 * where it does (arcs into shorter arcs).
 */
function keptStretches(
  polygon: CamPolygon,
  keep: ((p: CamPoint) => boolean) | null,
): CamPolygon[] {
  const { vertices, close } = polygon;
  const kept = vertices.map((p) => !keep || keep(p));
  if (kept.every(Boolean)) {
    return [polygon];
  }
  if (!kept.some(Boolean)) {
    return [];
  }
  const n = vertices.length;
  // Loops start where a kept stretch begins.
  const first = close
    ? kept.findIndex((k, i) => k && !kept[(i - 1 + n) % n])
    : 0;

  // How far (0 to 1) along segment i, from `fromStart` its start or its
  // end, it stays kept.
  const lastKept = (i: number, fromStart: boolean): number => {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const bulge = bulgeOf(a);
    const length = segmentLength(a, b, bulge);
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * length > precision()) {
      const mid = (lo + hi) / 2;
      if (keep!(pointAlong(a, b, bulge, fromStart ? mid : 1 - mid))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return fromStart ? lo : 1 - lo;
  };
  // The vertex starting the part of segment i from t0 to t1.
  const part = (i: number, t0: number, t1: number): CamVertex => {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const bulge = bulgeOf(a);
    const p = pointAlong(a, b, bulge, t0);
    const partial = bulge ? Math.tan(((t1 - t0) * sweepOf(bulge)) / 4) : 0;
    return partial ? { ...p, bulge: partial } : p;
  };
  const endOf = (i: number, t: number): CamVertex => {
    const a = vertices[i];
    return pointAlong(a, vertices[(i + 1) % n], bulgeOf(a), t);
  };

  const order = close
    ? [...Array(n).keys()].map((i) => (first + i) % n)
    : [...Array(n).keys()];
  const stretches: CamPolygon[] = [];
  // A loop's first stretch starts where the edge into it comes back in.
  let current: CamVertex[] | null = null;
  if (close) {
    const into = (first - 1 + n) % n;
    const t = lastKept(into, false);
    current = [part(into, t, 1)];
  }
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const hasNext = close || k < order.length - 1;
    const j = close ? order[(k + 1) % n] : order[k + 1];
    if (kept[i]) {
      current ??= [];
      if (hasNext && !kept[j]) {
        // Out along part of segment i.
        const t = lastKept(i, true);
        current.push(part(i, 0, t), endOf(i, t));
      } else {
        current.push(vertices[i]);
      }
    } else if (hasNext && kept[j] && k < order.length - 1) {
      // (The edge back into the first stretch was handled at the start.)
      const t = lastKept(i, false);
      current = [part(i, t, 1)];
    }
    if (current && (!hasNext || !kept[j])) {
      if (current.length > 1) {
        // An open path: its last vertex starts no segment.
        const last = current[current.length - 1];
        current[current.length - 1] = { x: last.x, y: last.y };
        stretches.push({ vertices: current, close: false });
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
  polygon: CamPolygon,
  side: 'outside' | 'inside' | 'on-line',
  direction: 'climb' | 'conventional',
): CamPolygon {
  if (!polygon.close) {
    return polygon;
  }

  const wantCounterClockwise =
    direction === 'climb' ? side === 'inside' : side !== 'inside';

  const isCounterClockwise = signedArea(polygon) > 0;
  return isCounterClockwise === wantCounterClockwise
    ? polygon
    : reversePolygon(polygon);
}

/** One pass along `points` at `depth`; returns the path as it was cut. */
function carvePass(
  builder: GCodeBuilder,
  points: CamVertex[],
  close: boolean,
  from: number,
  depth: number,
  options: { rampAngle: number | null; toolSize: number },
  resume?: Resume,
): CamVertex[] {
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
  // Vertices the tool visits in order (along the arc each one's bulge
  // shapes); a closed loop returns to its start.
  const loop = close ? [...points, points[0]] : points;
  for (let i = 1; i < loop.length; i++) {
    builder.arcTo(loop[i].x, loop[i].y, bulgeOf(loop[i - 1]));
  }
  return points;
}
