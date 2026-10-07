import { GCodeBuilder } from './gcode-builder';
import {
  bulgeOf,
  closestOnSegment,
  paramOnSegment,
  pointAlong,
  segmentLength,
  sweepOf,
} from './arcs';
import { CamPoint, CamPoint3, CamVertex } from './types';

const EPS = 1e-6;

/**
 * A move of a ramp: to (x, y, z), in a line from the move before, or along
 * an arc (`arc`, its bulge: see `src/cam/arcs.ts`) — a helix, as Z changes.
 */
export type RampMove = CamPoint3 & { arc?: number };

/**
 * Paths here are vertices whose bulge shapes the segment to the next one
 * (see `src/cam/arcs.ts`): lines and arcs. Plain points are straight
 * segments.
 */
type Path = CamVertex[];

/**
 * The moves of a ramp into a cut starting at `points[0]`: instead of plunging
 * straight down, the bit goes from Z `from` down to `to` while moving along
 * the path, `angle` degrees below horizontal.
 * - closed loops: along the end of the loop (going round more than once if
 *   it's short), arriving at `points[0]` at full depth. The cut that follows
 *   goes round the whole loop, so it finishes the ramped stretch at depth.
 *   With `maxLength`, the ramp stays within that much of the loop's end,
 *   going back and forth along it if needed (e.g. to keep clear of tabs).
 * - open paths: back and forth along the start of the path, ending at
 *   `points[0]`.
 * Back and forth on a stretch too short for whole trips makes the ramp a bit
 * shallower than `angle`. The first move is where to plunge down to `from`.
 * Empty when there's nothing to ramp (no depth to go down, no angle or no
 * path to ramp along). Along arcs the ramp follows them, as helices.
 *
 * `floor` (open paths only) is the lowest the bit may go at each distance
 * along the path, for a cut whose depth varies (a v-carve rising towards a
 * corner): the ramp then never goes below the cut itself.
 */
export function rampMoves(
  points: Path,
  close: boolean,
  from: number,
  to: number,
  angle: number,
  maxLength = Infinity,
  floor?: (along: number) => number,
): RampMove[] {
  const drop = from - to;
  const tan = Math.tan((angle * Math.PI) / 180);
  if (!(drop > EPS) || !(tan > EPS) || points.length < 2) {
    return [];
  }
  const length = drop / tan;
  if (!close) {
    return zigZagRamp(points, from, to, length, floor);
  }
  if (length <= maxLength) {
    // Straight along the end of the loop, from `length` back to points[0].
    const back = walkBack(points, length);
    return forwards(back).map((step) => ({
      ...step,
      z: to + ((from - to) * step.distance) / length,
    }));
  }
  // Back and forth on the end of the loop, finishing forwards at points[0].
  const stretch = asPath(walkBack(points, maxLength));
  return zigZagRamp(stretch, from, to, length);
}

/**
 * Where the bit is when a pass starts over a path it has just cut: at
 * `point` on the path, still `down` at the depth of the pass before (the end
 * of that pass) or up at safe height.
 */
export type Resume = { point: CamPoint; down: boolean };

/**
 * Get the bit to Z `to` at the start of a cut along `points`, and return the
 * path to cut from there.
 *
 * Fresh (from safe height): travel to the path's start and plunge, or ramp
 * from `from` when `rampAngle` is set (see rampMoves for `maxLength`).
 *
 * With `resume`, it carries on from where the previous pass was (see
 * Resume), already at `from` there or plunging to it into the cut below:
 * on a closed loop the ramp goes on forwards and the loop is returned
 * starting where it ends (back and forth from there when it can't go
 * further than `maxLength`); an open path must start at the resume point,
 * and the ramp goes back and forth from there.
 *
 * A ramp that wouldn't take the tool at least its radius away from where it
 * would plunge hardly helps (a short stretch between tabs, a loop smaller
 * than the tool), so it plunges instead.
 *
 * `floor`: see rampMoves (fresh entries only).
 */
export function enterCut(
  builder: GCodeBuilder,
  points: Path,
  close: boolean,
  from: number,
  to: number,
  rampAngle: number | null,
  toolSize: number,
  maxLength = Infinity,
  resume?: Resume,
  floor?: (along: number) => number,
): Path {
  const ramps =
    !!rampAngle &&
    from - to > EPS &&
    rampReach(points, close, from - to, rampAngle, maxLength) >=
      toolSize / 2 - EPS;

  if (!resume) {
    const ramp = ramps
      ? rampMoves(points, close, from, to, rampAngle!, maxLength, floor)
      : [];
    if (!ramp.length) {
      builder.travelTo(points[0].x, points[0].y);
      builder.plunge(to);
      return points;
    }
    builder.travelTo(ramp[0].x, ramp[0].y);
    builder.plunge(from);
    carveAll(builder, ramp.slice(1));
    return points;
  }

  const path = close ? startingAt(points, arcTo(points, resume.point)) : points;
  if (!resume.down) {
    builder.travelTo(path[0].x, path[0].y);
    builder.plunge(from);
  }
  if (!ramps) {
    builder.plunge(to);
    return path;
  }
  const needed = (from - to) / Math.tan((rampAngle! * Math.PI) / 180);
  if (!close || needed > maxLength) {
    // Back and forth from here, ending here (see rampMoves).
    carveAll(
      builder,
      rampMoves(path, close, from, to, rampAngle!, maxLength).slice(1),
    );
    return path;
  }
  // Forwards round the loop: walking back round the reversed loop.
  const reversed = reverseLoop(path);
  carveAll(
    builder,
    walkBack(reversed, needed)
      .slice(1)
      .map((step) => ({
        ...step,
        z: from - ((from - to) * step.distance) / needed,
      })),
  );
  return startingAt(path, needed);
}

/**
 * The points along a closed loop from points[0] for `length` (round more
 * than once if needed), not counting points[0] itself.
 */
export function alongLoop(points: Path, length: number): CamPoint[] {
  return walkBack(reverseLoop(points), length)
    .slice(1)
    .map(({ x, y }) => ({ x, y }));
}

function carveAll(builder: GCodeBuilder, moves: RampMove[]) {
  for (const move of moves) {
    if (move.arc) {
      builder.arcTo(move.x, move.y, move.arc, move.z);
    } else {
      builder.carveTo(move.x, move.y, move.z);
    }
  }
}

/** How far round the closed loop (from points[0]) its nearest point to `p` is. */
export function arcTo(points: Path, p: CamPoint): number {
  let best = { distance: Infinity, along: 0 };
  let traveled = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const bulge = bulgeOf(a);
    const length = segmentLength(a, b, bulge);
    const { point, distance } = closestOnSegment(p, a, b, bulge);
    if (distance < best.distance) {
      best = {
        distance,
        along: traveled + length * paramOnSegment(a, b, bulge, point),
      };
    }
    traveled += length;
  }
  return best.along;
}

/**
 * The closed loop, starting `along` along it from points[0] (wrapping): a
 * segment split there is split into two with the same curve.
 */
export function startingAt(points: Path, along: number): Path {
  const n = points.length;
  const perimeter = pathLength(points, true);
  if (perimeter < EPS) {
    return points;
  }
  let target = ((along % perimeter) + perimeter) % perimeter;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const bulge = bulgeOf(a);
    const edge = segmentLength(a, b, bulge);
    if (target <= edge + EPS || i === n - 1) {
      const rest = [...points.slice(i + 1), ...points.slice(0, i + 1)];
      if (target < EPS) {
        // On vertex i itself.
        return [a, ...rest.slice(0, -1)];
      }
      if (target > edge - EPS) {
        // On the next vertex.
        return rest;
      }
      const t = target / edge;
      const split = pointAlong(a, b, bulge, t);
      // The segment's start (now last) keeps the first part of the curve,
      // the split point the rest.
      const first = { ...a, bulge: partBulge(bulge, 0, t) };
      return [
        withBulge(split, partBulge(bulge, t, 1)),
        ...rest.slice(0, -1),
        withBulge(first, first.bulge),
      ];
    }
    target -= edge;
  }
  return points;
}

/** Bulge of the part of a segment from t0 to t1 (0 to 1 along it). */
function partBulge(bulge: number, t0: number, t1: number): number {
  return bulge ? Math.tan(((t1 - t0) * sweepOf(bulge)) / 4) : 0;
}

function withBulge(p: CamPoint, bulge: number): CamVertex {
  return bulge ? { x: p.x, y: p.y, bulge } : { x: p.x, y: p.y };
}

/**
 * How far a ramp dropping `drop` takes the tool from where it would have
 * plunged: the stretch it goes along, or a loop's diameter when it goes
 * round and round.
 */
function rampReach(
  points: Path,
  close: boolean,
  drop: number,
  angle: number,
  maxLength: number,
): number {
  const needed = drop / Math.tan((angle * Math.PI) / 180);
  const length = pathLength(points, close);
  if (!close) {
    // Back and forth up to half the ramp's length out (see zigZagRamp).
    return Math.min(length, needed / 2);
  }
  // Along the end of the loop, or back and forth on its last `maxLength`;
  // round a small loop, it's the loop's size that counts.
  return Math.min(Math.min(needed, maxLength), length / Math.PI);
}

function pathLength(points: Path, close: boolean) {
  let length = 0;
  const n = close ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    length += segmentLength(a, points[(i + 1) % points.length], bulgeOf(a));
  }
  return length;
}

/** A closed loop the other way round, still starting at points[0]. */
function reverseLoop(points: Path): Path {
  const n = points.length;
  // Vertex k of the result is the old vertex (n − k) % n; the segment from
  // it runs back along the old segment into it, from old vertex n − k − 1.
  return points.map((_, k) => {
    const old = points[(n - k) % n];
    const before = points[(n - k - 1 + n) % n];
    return withBulge(old, -bulgeOf(before));
  });
}

/** A step of a walk: where, how far along, and the arc arriving there. */
type Step = CamPoint & { distance: number; arc?: number };

/**
 * Points going backwards round a closed loop from points[0] for `length`
 * (round more than once if needed), with how far back each one is and the
 * arc (if any) the walk follows into it.
 */
function walkBack(points: Path, length: number): Step[] {
  const n = points.length;
  const back: Step[] = [{ x: points[0].x, y: points[0].y, distance: 0 }];
  let distance = 0;
  let stuck = 0;
  for (let k = 0; ; k++) {
    const current = points[(n - (k % n)) % n];
    const previous = points[(n - ((k + 1) % n)) % n];
    // Backwards along the segment from `previous` to `current`.
    const bulge = -bulgeOf(previous);
    const edge = segmentLength(current, previous, bulge);
    // A loop with no length never gets anywhere.
    stuck = edge > EPS ? 0 : stuck + 1;
    if (stuck > n) {
      return back;
    }
    if (distance + edge >= length - EPS) {
      const t = edge > EPS ? (length - distance) / edge : 0;
      back.push({
        ...pointAlong(current, previous, bulge, t),
        distance: length,
        arc: partBulge(bulge, 0, t) || undefined,
      });
      return back;
    }
    distance += edge;
    back.push({
      x: previous.x,
      y: previous.y,
      distance,
      arc: bulge || undefined,
    });
  }
}

/**
 * The steps of a walk taken the other way: last first, each arriving by the
 * reverse of the arc it left by.
 */
function forwards(steps: Step[]): Step[] {
  const m = steps.length - 1;
  return steps.map((_, i) => {
    const step = steps[m - i];
    const arc = i > 0 ? -(steps[m - i + 1].arc ?? 0) : 0;
    return {
      x: step.x,
      y: step.y,
      distance: step.distance,
      arc: arc || undefined,
    };
  });
}

/** Steps as a path (each vertex's bulge: the arc on to the next step). */
function asPath(steps: Step[]): Path {
  return steps.map((step, i) => withBulge(step, steps[i + 1]?.arc ?? 0));
}

/** Out along the path and back to points[0], as often as needed. */
function zigZagRamp(
  points: Path,
  from: number,
  to: number,
  length: number,
  floor?: (along: number) => number,
): RampMove[] {
  const available = pathLength(points, false);
  if (available < EPS) {
    return [];
  }

  // Out `reach` and back is one trip; enough trips to cover `length`.
  const reach = Math.min(available, length / 2);
  const trips = Math.ceil(length / (2 * reach) - EPS);
  const total = 2 * reach * trips;

  // The stretch from points[0] to `reach` along the path, each point with
  // the arc arriving there from the one before.
  const out: Array<CamPoint & { along: number; arc?: number }> = [
    { x: points[0].x, y: points[0].y, along: 0 },
  ];
  let along = 0;
  for (let i = 1; i < points.length && along < reach - EPS; i++) {
    const a = points[i - 1];
    const bulge = bulgeOf(a);
    const edge = segmentLength(a, points[i], bulge);
    if (along + edge >= reach - EPS) {
      const t = edge > EPS ? (reach - along) / edge : 0;
      out.push({
        ...pointAlong(a, points[i], bulge, t),
        along: reach,
        arc: partBulge(bulge, 0, t) || undefined,
      });
      break;
    }
    along += edge;
    out.push({
      x: points[i].x,
      y: points[i].y,
      along,
      arc: bulge || undefined,
    });
  }

  const moves: RampMove[] = [{ x: out[0].x, y: out[0].y, z: from }];
  let traveled = 0;
  const visit = (
    point: CamPoint & { along: number },
    distance: number,
    arc: number | undefined,
  ) => {
    traveled += distance;
    const z = from - ((from - to) * traveled) / total;
    moves.push({
      x: point.x,
      y: point.y,
      z: floor ? Math.max(z, floor(point.along)) : z,
      ...(arc ? { arc } : {}),
    });
  };
  for (let trip = 0; trip < trips; trip++) {
    for (let i = 1; i < out.length; i++) {
      visit(out[i], out[i].along - out[i - 1].along, out[i].arc);
    }
    for (let i = out.length - 2; i >= 0; i--) {
      // Back along the arc that led out to the next point.
      const arc = out[i + 1].arc;
      visit(out[i], out[i + 1].along - out[i].along, arc ? -arc : undefined);
    }
  }
  // Land exactly on the target depth.
  moves[moves.length - 1].z = to;
  return moves;
}
