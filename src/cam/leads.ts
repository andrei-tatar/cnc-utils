import { getDistance } from '../util';
import { CamPoint } from './types';

/** Points along a lead arc: this many per quarter turn. */
const LEAD_SEGMENTS = 8;

/**
 * A loop (starting and ending at `points[0]`) as an open path with a quarter
 * arc of `radius` into its start and one out of its end, tangent to it and
 * curving away to the waste side: outside an outside profile, inside an
 * inside one.
 */
export function withLeads(
  points: CamPoint[],
  side: 'outside' | 'inside' | 'on-line',
  radius: number,
): CamPoint[] {
  const n = points.length;
  const p0 = points[0];
  const unit = (a: CamPoint, b: CamPoint) => {
    const d = getDistance(a, b) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  };
  // Waste to the right of the direction of travel on a counter-clockwise
  // loop when the waste is outside it, and the other way round.
  const ccw = signedArea(points) > 0;
  const wasteOnRight = ccw === (side !== 'inside');
  const normal = (t: CamPoint) =>
    wasteOnRight ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x };
  // Along the arc whose centre is `radius` to the waste side of p0, from
  // angle 0 at p0 (heading along `t`) to `phi`.
  const arc = (t: CamPoint, from: number, to: number) => {
    const nrm = normal(t);
    const c = { x: p0.x + nrm.x * radius, y: p0.y + nrm.y * radius };
    const out: CamPoint[] = [];
    for (let i = 0; i <= LEAD_SEGMENTS; i++) {
      const phi = from + ((to - from) * i) / LEAD_SEGMENTS;
      out.push({
        x: c.x + radius * (-nrm.x * Math.cos(phi) + t.x * Math.sin(phi)),
        y: c.y + radius * (-nrm.y * Math.cos(phi) + t.y * Math.sin(phi)),
      });
    }
    return out;
  };
  const tIn = unit(points[n - 1], p0);
  const tOut = unit(p0, points[1]);
  const leadIn = arc(tOut, -Math.PI / 2, 0).slice(0, -1);
  const leadOut = arc(tIn, 0, Math.PI / 2).slice(1);
  return [...leadIn, ...points, p0, ...leadOut];
}

/** The signed area of a loop: positive when counter-clockwise. */
export function signedArea(points: CamPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
