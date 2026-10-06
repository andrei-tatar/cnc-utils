import { CamPoint, CamPoint3 } from './types';

/** A run of points written as one move. */
export type FittedMove =
  | { type: 'line'; to: CamPoint }
  | {
      type: 'arc';
      to: CamPoint;
      center: CamPoint;
      clockwise: boolean;
      /** The points the arc stands in for (without its start). */
      points: CamPoint[];
    };

/** Fewest points (start included) worth turning into an arc. */
const MIN_ARC_POINTS = 5;
/** Larger radii are as good as straight: leave them as lines. */
const MAX_RADIUS = 2000;
/** Keep each arc well short of a full turn (end ≠ start, stable centre). */
const MAX_SWEEP = 1.5 * Math.PI;

/** How closely an arc has to follow the points it replaces, in mm. */
export type ArcTolerance = {
  /** Every point's distance from the circle. */
  points: number;
  /**
   * How far a segment's middle may be from the arc. The segments are
   * themselves only within the curve tolerance of the curve they stand for,
   * so this can be as loose as that.
   */
  chords: number;
};

/**
 * Replaces runs of short segments that follow a circle with arcs.
 * `points[0]` is where the tool already is; the result covers the rest, in
 * order.
 */
export function fitArcs(
  points: CamPoint[],
  tolerance: ArcTolerance,
): FittedMove[] {
  const moves: FittedMove[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const arc = longestArc(points, i, tolerance);
    if (arc) {
      moves.push(arc.move);
      i = arc.end;
    } else {
      moves.push({ type: 'line', to: points[i + 1] });
      i++;
    }
  }
  return moves;
}

/** The longest arc starting at `start`, or null if there's none. */
function longestArc(
  points: CamPoint[],
  start: number,
  tolerance: ArcTolerance,
) {
  const last = points.length - 1;
  let end = start + MIN_ARC_POINTS - 1;
  if (end > last) return null;
  let arc = arcThrough(points, start, end, tolerance);
  if (!arc) return null;
  let best = { move: arc, end };

  // Double the run while it still fits, then narrow down between the last
  // fit and the first miss: a run that stops fitting rarely fits again a
  // few points later, and checking each length in turn would be quadratic.
  let step = MIN_ARC_POINTS;
  let miss = -1;
  while (best.end < last) {
    end = Math.min(last, best.end + step);
    arc = arcThrough(points, start, end, tolerance);
    if (!arc) {
      miss = end;
      break;
    }
    best = { move: arc, end };
    step *= 2;
  }
  if (miss > 0) {
    let lo = best.end;
    let hi = miss;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const fit = arcThrough(points, start, mid, tolerance);
      if (fit) {
        best = { move: fit, end: mid };
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }
  return best;
}

/** An arc through `points[start..end]`, or null if they don't make one. */
function arcThrough(
  points: CamPoint[],
  start: number,
  end: number,
  tolerance: ArcTolerance,
): FittedMove | null {
  const center = fitCircle(points, start, end);
  if (!center) return null;
  const a = points[start];
  const radius = Math.hypot(a.x - center.x, a.y - center.y);
  if (!(radius < MAX_RADIUS) || radius < tolerance.points * 4) return null;

  // Every point on the circle, every segment turning the same way, and no
  // segment so long its middle strays from the circle.
  let turn = 0;
  let sweep = 0;
  const sweeps: number[] = [];
  let previousAngle = Math.atan2(a.y - center.y, a.x - center.x);
  for (let k = start; k <= end; k++) {
    const p = points[k];
    const off = Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius);
    if (off > tolerance.points) {
      return null;
    }
    if (k === start) continue;
    const angle = Math.atan2(p.y - center.y, p.x - center.x);
    let delta = angle - previousAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const direction = Math.sign(delta);
    if (direction === 0) return null;
    if (turn === 0) turn = direction;
    else if (direction !== turn) return null;
    // Chord sagitta: r(1 - cos(Δ/2)).
    if (radius * (1 - Math.cos(delta / 2)) > tolerance.chords) return null;
    sweep += Math.abs(delta);
    if (sweep > MAX_SWEEP) return null;
    sweeps.push(sweep);
    previousAngle = angle;
  }

  // Points with a Z: it must change evenly round the arc (a helix), so a
  // single arc with a Z can stand for them.
  const z0 = (a as Partial<CamPoint3>).z;
  const z1 = (points[end] as Partial<CamPoint3>).z;
  if (typeof z0 === 'number' && typeof z1 === 'number') {
    for (let k = start + 1; k <= end; k++) {
      const z = (points[k] as Partial<CamPoint3>).z ?? z0;
      const expected = z0 + ((z1 - z0) * sweeps[k - start - 1]) / sweep;
      if (Math.abs(z - expected) > tolerance.points) return null;
    }
  }

  return {
    type: 'arc',
    to: points[end],
    center,
    clockwise: turn < 0,
    points: points.slice(start + 1, end + 1),
  };
}

/** Least-squares circle centre (Kåsa fit), or null for a straight run. */
function fitCircle(points: CamPoint[], start: number, end: number) {
  const n = end - start + 1;
  // Centred on the mean, for numerical stability.
  let mx = 0;
  let my = 0;
  for (let k = start; k <= end; k++) {
    mx += points[k].x;
    my += points[k].y;
  }
  mx /= n;
  my /= n;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (let k = start; k <= end; k++) {
    const u = points[k].x - mx;
    const v = points[k].y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  const scale = (suu + svv) ** 2;
  if (!(Math.abs(det) > 1e-12 * scale)) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  return { x: uc + mx, y: vc + my };
}
