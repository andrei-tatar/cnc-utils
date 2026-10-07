import { bulgeOf, signedArea, tangentAt } from './arcs';
import { CamPoint, CamVertex } from './types';

/**
 * A loop (starting and ending at `vertices[0]`) as an open path with a
 * quarter arc of `radius` into its start and one out of its end, tangent to
 * it and curving away to the waste side: outside an outside profile, inside
 * an inside one. The leads are true arcs (a vertex each, see
 * `src/cam/arcs.ts`); the loop's own vertices are kept as they are.
 */
export function withLeads(
  vertices: CamVertex[],
  side: 'outside' | 'inside' | 'on-line',
  radius: number,
): CamVertex[] {
  const n = vertices.length;
  const p0 = vertices[0];
  // Waste to the right of the direction of travel on a counter-clockwise
  // loop when the waste is outside it, and the other way round.
  const ccw = signedArea({ vertices, close: true }) > 0;
  const wasteOnRight = ccw === (side !== 'inside');
  const normal = (t: CamPoint) =>
    wasteOnRight ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x };
  // Turning round a centre on the right is clockwise.
  const bulge = (wasteOnRight ? -1 : 1) * Math.tan(Math.PI / 8);
  // The directions the loop arrives at and leaves its start in.
  const last = vertices[n - 1];
  const tIn = tangentAt(last, p0, bulgeOf(last), 1);
  const tOut = tangentAt(p0, vertices[1 % n], bulgeOf(p0), 0);
  // In: a quarter turn ending at p0 heading along tOut, round a centre
  // `radius` to the waste side; out: one starting along tIn.
  const nIn = normal(tOut);
  const start = {
    x: p0.x + nIn.x * radius - tOut.x * radius,
    y: p0.y + nIn.y * radius - tOut.y * radius,
  };
  const nOut = normal(tIn);
  const end = {
    x: p0.x + nOut.x * radius + tIn.x * radius,
    y: p0.y + nOut.y * radius + tIn.y * radius,
  };
  return [{ ...start, bulge }, ...vertices, { x: p0.x, y: p0.y, bulge }, end];
}
