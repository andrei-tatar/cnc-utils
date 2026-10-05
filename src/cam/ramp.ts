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
 * Get the bit to Z `to` at the start of `points` (from safe height): travel
 * there, then plunge, or ramp from `from` when `rampAngle` is set (see
 * rampMoves for `maxLength`). Returns how far a ramp takes the tool from
 * where it would have plunged: the stretch it goes along, or a loop's
 * diameter when it goes round and round (0: no room, it plunged); null when
 * there was no ramp to make.
 */
export function enterCut(
  builder: GCodeBuilder,
  points: CamPoint[],
  close: boolean,
  from: number,
  to: number,
  rampAngle: number | null,
  maxLength = Infinity,
): number | null {
  const ramp = rampAngle
    ? rampMoves(points, close, from, to, rampAngle, maxLength)
    : [];
  if (!ramp.length) {
    builder.travelTo(points[0].x, points[0].y);
    builder.plunge(to);
  } else {
    builder.travelTo(ramp[0].x, ramp[0].y);
    builder.plunge(from);
    for (const move of ramp.slice(1)) {
      builder.carveTo(move.x, move.y, move.z);
    }
  }
  if (!rampAngle || !(from - to > EPS)) {
    return null;
  }
  if (!ramp.length) {
    return 0;
  }
  const needed = (from - to) / Math.tan((rampAngle * Math.PI) / 180);
  const length = pathLength(points, close);
  if (!close) {
    // Back and forth up to half the ramp's length out (see zigZagRamp).
    return Math.min(length, needed / 2);
  }
  // Along the end of the loop, or back and forth on its last `maxLength`;
  // round a small loop, it's the loop's size that counts.
  const along = needed <= maxLength ? needed : maxLength;
  return Math.min(along, length / Math.PI);
}

/**
 * A warning for ramps that take the tool less than its radius from where it
 * would have plunged (`reaches` from enterCut), so they hardly help; null
 * when they all had room.
 */
export function rampWarning(
  reaches: Array<number | null>,
  toolSize: number,
): string | null {
  const ramps = reaches.filter((r): r is number => r !== null);
  const short = ramps.filter((r) => r < toolSize / 2 - EPS);
  if (!short.length) {
    return null;
  }
  const plunged = short.filter((r) => r === 0).length;
  const shuffled = short.length - plunged;
  const parts = [
    shuffled &&
      `${shuffled} of ${ramps.length} ramps have less than ${toolSize / 2} mm (the tool's radius) to move along, so they're close to plunging`,
    plunged &&
      `${plunged} of ${ramps.length} ramps have no room at all and plunge`,
  ].filter(Boolean);
  return `${parts.join('; ')}.`;
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
