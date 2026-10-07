import { bulgeForSweep, closestOnSegment } from './arcs';
import { CamPoint, CamVertex } from './types';

/**
 * Curves as arcs: a biarc is two circular arcs meeting with the same
 * tangent, between two points with given tangents. Fitting biarcs to a
 * curve, splitting it until each stays within the tolerance, gives a
 * smooth path (no corners) that offsets exactly — unlike lines, which turn
 * every curve into a polygon.
 */

/** A curve, by parameter from 0 to 1. */
export type ParametricCurve = {
  point(t: number): CamPoint;
  /** Direction of travel (needn't be unit). */
  tangent(t: number): CamPoint;
};

const unit = (v: CamPoint): CamPoint => {
  const l = Math.hypot(v.x, v.y);
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
};
const sub = (a: CamPoint, b: CamPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: CamPoint, b: CamPoint) => a.x * b.x + a.y * b.y;
const cross = (a: CamPoint, b: CamPoint) => a.x * b.y - a.y * b.x;

/** Bulge of the arc from `a` to `b` leaving `a` along unit tangent `t`. */
function bulgeLeaving(a: CamPoint, b: CamPoint, t: CamPoint): number {
  const chord = sub(b, a);
  return Math.tan(Math.atan2(cross(t, chord), dot(t, chord)) / 2);
}

/** Bulge of the arc from `a` to `b` arriving at `b` along unit tangent `t`. */
function bulgeArriving(a: CamPoint, b: CamPoint, t: CamPoint): number {
  const chord = sub(b, a);
  return Math.tan(Math.atan2(cross(chord, t), dot(chord, t)) / 2);
}

/**
 * The biarc from `p0` (leaving along `t0`) to `p1` (arriving along `t1`),
 * as two vertices (`p0`, the join) with their bulges; one straight vertex
 * when the tangents run along the chord.
 */
export function biarc(
  p0: CamPoint,
  t0: CamPoint,
  p1: CamPoint,
  t1: CamPoint,
): CamVertex[] {
  t0 = unit(t0);
  t1 = unit(t1);
  const v = sub(p1, p0);
  const chord = Math.hypot(v.x, v.y);
  if (chord === 0) {
    return [];
  }
  const along = { x: v.x / chord, y: v.y / chord };
  if (
    Math.abs(cross(t0, along)) < 1e-12 &&
    Math.abs(cross(t1, along)) < 1e-12
  ) {
    return [{ x: p0.x, y: p0.y }];
  }
  // Equal-length tangent legs: |p0 + d t0 − (p1 − d t1)| = 2d.
  const t = { x: t0.x + t1.x, y: t0.y + t1.y };
  const a = 2 * (1 - dot(t0, t1));
  const b = 2 * dot(v, t);
  const c = -dot(v, v);
  let d: number;
  if (Math.abs(a) < 1e-12) {
    d = -c / b;
  } else {
    const disc = Math.max(0, b * b - 4 * a * c);
    d = (-b + Math.sqrt(disc)) / (2 * a);
  }
  if (!(d > 0) || !Number.isFinite(d)) {
    // Tangents that don't allow a biarc this way: one arc from p0.
    return [{ x: p0.x, y: p0.y, bulge: bulgeLeaving(p0, p1, t0) }];
  }
  const q0 = { x: p0.x + d * t0.x, y: p0.y + d * t0.y };
  const q1 = { x: p1.x - d * t1.x, y: p1.y - d * t1.y };
  const join = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
  const b1 = bulgeLeaving(p0, join, t0);
  const b2 = bulgeArriving(join, p1, t1);
  const first: CamVertex = b1
    ? { x: p0.x, y: p0.y, bulge: b1 }
    : { x: p0.x, y: p0.y };
  const second: CamVertex = b2 ? { ...join, bulge: b2 } : join;
  return [first, second];
}

/**
 * Biarcs along `curve` from t0 to t1 within `tolerance`: vertices from the
 * curve's start (its end not included).
 */
export function fitBiarcs(
  curve: ParametricCurve,
  tolerance: number,
  t0 = 0,
  t1 = 1,
  depth = 0,
): CamVertex[] {
  const p0 = curve.point(t0);
  const p1 = curve.point(t1);
  const mid = (t0 + t1) / 2;
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-9) {
    // Back where it started: nothing, or a loop (a whole ellipse) to halve.
    const pm = curve.point(mid);
    if (Math.hypot(pm.x - p0.x, pm.y - p0.y) < 1e-9 || depth >= 16) {
      return [];
    }
    return [
      ...fitBiarcs(curve, tolerance, t0, mid, depth + 1),
      ...fitBiarcs(curve, tolerance, mid, t1, depth + 1),
    ];
  }
  const vertices = biarc(p0, curve.tangent(t0), p1, curve.tangent(t1));
  if (depth >= 16 || !vertices.length) {
    return vertices.length ? vertices : [{ x: p0.x, y: p0.y }];
  }
  // How far the curve strays from the biarc, sampled.
  const ends = [...vertices, { x: p1.x, y: p1.y }];
  let error = 0;
  const samples = 12;
  for (let k = 1; k < samples; k++) {
    const p = curve.point(t0 + ((t1 - t0) * k) / samples);
    let nearest = Infinity;
    for (let i = 0; i < ends.length - 1; i++) {
      nearest = Math.min(
        nearest,
        closestOnSegment(p, ends[i], ends[i + 1], ends[i].bulge ?? 0).distance,
      );
    }
    error = Math.max(error, nearest);
    if (error > tolerance) break;
  }
  if (error <= tolerance) {
    return vertices;
  }
  return [
    ...fitBiarcs(curve, tolerance, t0, mid, depth + 1),
    ...fitBiarcs(curve, tolerance, mid, t1, depth + 1),
  ];
}

/**
 * A circular arc around `center` from angle `start` sweeping `sweep`
 * (radians, positive counter-clockwise), as vertices of at most a half
 * turn each (from its start; its end not included).
 */
export function circularArc(
  center: CamPoint,
  radius: number,
  start: number,
  sweep: number,
): CamVertex[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-9));
  const step = sweep / pieces;
  const bulge = bulgeForSweep(step);
  return Array.from({ length: pieces }, (_, k) => ({
    x: center.x + radius * Math.cos(start + step * k),
    y: center.y + radius * Math.sin(start + step * k),
    bulge,
  }));
}

/** A quadratic Bézier as a parametric curve. */
export function quadratic(
  p0: CamPoint,
  c: CamPoint,
  p1: CamPoint,
): ParametricCurve {
  return {
    point: (t) => {
      const u = 1 - t;
      return {
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
      };
    },
    tangent: (t) => {
      const d = {
        x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
        y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y),
      };
      // At an end where the control point coincides: the chord.
      return d.x || d.y ? d : sub(p1, p0);
    },
  };
}

/** A cubic Bézier as a parametric curve. */
export function cubic(
  p0: CamPoint,
  c0: CamPoint,
  c1: CamPoint,
  p1: CamPoint,
): ParametricCurve {
  return {
    point: (t) => {
      const u = 1 - t;
      const a = u * u * u,
        b = 3 * u * u * t,
        c = 3 * u * t * t,
        d = t * t * t;
      return {
        x: a * p0.x + b * c0.x + c * c1.x + d * p1.x,
        y: a * p0.y + b * c0.y + c * c1.y + d * p1.y,
      };
    },
    tangent: (t) => {
      const u = 1 - t;
      const d = {
        x:
          3 * u * u * (c0.x - p0.x) +
          6 * u * t * (c1.x - c0.x) +
          3 * t * t * (p1.x - c1.x),
        y:
          3 * u * u * (c0.y - p0.y) +
          6 * u * t * (c1.y - c0.y) +
          3 * t * t * (p1.y - c1.y),
      };
      if (d.x || d.y) return d;
      // A control point on its end: the direction to the next one.
      const next = t < 0.5 ? (c1.x !== p0.x || c1.y !== p0.y ? c1 : p1) : p1;
      const prev = t < 0.5 ? p0 : c0.x !== p1.x || c0.y !== p1.y ? c0 : p0;
      return sub(next, prev);
    },
  };
}
