import { GCodeBuilder } from './gcode-builder';
import { CamPoint, CamPoint3 } from './types';
import { getDistance } from '../util';

const EPS = 1e-6;

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
 * path to ramp along).
 */
export function rampMoves(
  points: CamPoint[],
  close: boolean,
  from: number,
  to: number,
  angle: number,
  maxLength = Infinity,
): CamPoint3[] {
  const drop = from - to;
  const tan = Math.tan((angle * Math.PI) / 180);
  if (!(drop > EPS) || !(tan > EPS) || points.length < 2) {
    return [];
  }
  const length = drop / tan;
  if (!close) {
    return zigZagRamp(points, from, to, length);
  }
  if (length <= maxLength) {
    // Straight along the end of the loop, from `length` back to points[0].
    return walkBack(points, length)
      .reverse()
      .map(({ point, distance }) => ({
        ...point,
        z: to + ((from - to) * distance) / length,
      }));
  }
  // Back and forth on the end of the loop, finishing forwards at points[0].
  const stretch = walkBack(points, maxLength).map(({ point }) => point);
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
 */
export function enterCut(
  builder: GCodeBuilder,
  points: CamPoint[],
  close: boolean,
  from: number,
  to: number,
  rampAngle: number | null,
  toolSize: number,
  maxLength = Infinity,
  resume?: Resume,
): CamPoint[] {
  const ramps =
    !!rampAngle &&
    from - to > EPS &&
    rampReach(points, close, from - to, rampAngle, maxLength) >=
      toolSize / 2 - EPS;

  if (!resume) {
    const ramp = ramps
      ? rampMoves(points, close, from, to, rampAngle!, maxLength)
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
  const reversed = [path[0], ...path.slice(1).reverse()];
  carveAll(
    builder,
    walkBack(reversed, needed)
      .slice(1)
      .map(({ point, distance }) => ({
        ...point,
        z: from - ((from - to) * distance) / needed,
      })),
  );
  return startingAt(path, needed);
}

function carveAll(builder: GCodeBuilder, moves: CamPoint3[]) {
  for (const move of moves) {
    builder.carveTo(move.x, move.y, move.z);
  }
}

/** How far round the closed loop (from points[0]) its nearest point to `p` is. */
function arcTo(points: CamPoint[], p: CamPoint): number {
  let best = { distance: Infinity, arc: 0 };
  let traveled = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
          )
        : 0;
    const distance = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (distance < best.distance) {
      best = { distance, arc: traveled + t * Math.sqrt(lengthSq) };
    }
    traveled += Math.sqrt(lengthSq);
  }
  return best.arc;
}

/** The closed loop, starting `arc` along it from points[0] (wrapping). */
function startingAt(points: CamPoint[], arc: number): CamPoint[] {
  const n = points.length;
  const perimeter = pathLength(points, true);
  if (perimeter < EPS) {
    return points;
  }
  let target = ((arc % perimeter) + perimeter) % perimeter;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const edge = getDistance(a, b);
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
      return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...rest];
    }
    target -= edge;
  }
  return points;
}

/**
 * How far a ramp dropping `drop` takes the tool from where it would have
 * plunged: the stretch it goes along, or a loop's diameter when it goes
 * round and round.
 */
function rampReach(
  points: CamPoint[],
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

function pathLength(points: CamPoint[], close: boolean) {
  let length = 0;
  const n = close ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    length += getDistance(points[i], points[(i + 1) % points.length]);
  }
  return length;
}

/**
 * Points going backwards round a closed loop from points[0] for `length`
 * (round more than once if needed), with how far back each one is.
 */
function walkBack(points: CamPoint[], length: number) {
  const n = points.length;
  const back: Array<{ point: CamPoint; distance: number }> = [
    { point: points[0], distance: 0 },
  ];
  let distance = 0;
  let stuck = 0;
  for (let k = 0; ; k++) {
    const current = points[(n - (k % n)) % n];
    const previous = points[(n - ((k + 1) % n)) % n];
    const edge = getDistance(current, previous);
    // A loop with no length never gets anywhere.
    stuck = edge > EPS ? 0 : stuck + 1;
    if (stuck > n) {
      return back;
    }
    if (distance + edge >= length - EPS) {
      const t = edge > EPS ? (length - distance) / edge : 0;
      back.push({
        point: {
          x: current.x + (previous.x - current.x) * t,
          y: current.y + (previous.y - current.y) * t,
        },
        distance: length,
      });
      return back;
    }
    distance += edge;
    back.push({ point: previous, distance });
  }
}

/** Out along the path and back to points[0], as often as needed. */
function zigZagRamp(
  points: CamPoint[],
  from: number,
  to: number,
  length: number,
): CamPoint3[] {
  const available = pathLength(points, false);
  if (available < EPS) {
    return [];
  }

  // Out `reach` and back is one trip; enough trips to cover `length`.
  const reach = Math.min(available, length / 2);
  const trips = Math.ceil(length / (2 * reach) - EPS);
  const total = 2 * reach * trips;

  // The stretch from points[0] to `reach` along the path.
  const out: Array<CamPoint & { along: number }> = [{ ...points[0], along: 0 }];
  let along = 0;
  for (let i = 1; i < points.length && along < reach - EPS; i++) {
    const edge = getDistance(points[i - 1], points[i]);
    if (along + edge >= reach - EPS) {
      const t = edge > EPS ? (reach - along) / edge : 0;
      out.push({
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
        along: reach,
      });
      break;
    }
    along += edge;
    out.push({ ...points[i], along });
  }

  const moves: CamPoint3[] = [{ x: out[0].x, y: out[0].y, z: from }];
  let traveled = 0;
  const visit = (point: CamPoint, distance: number) => {
    traveled += distance;
    moves.push({
      x: point.x,
      y: point.y,
      z: from - ((from - to) * traveled) / total,
    });
  };
  for (let trip = 0; trip < trips; trip++) {
    for (let i = 1; i < out.length; i++) {
      visit(out[i], out[i].along - out[i - 1].along);
    }
    for (let i = out.length - 2; i >= 0; i--) {
      visit(out[i], out[i + 1].along - out[i].along);
    }
  }
  // Land exactly on the target depth.
  moves[moves.length - 1].z = to;
  return moves;
}
