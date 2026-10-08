import { bulgeOf, pointAlong, segmentLength, tangentAt } from './arcs';
import { CamPoint, CamVertex } from './types';

/**
 * A loop (starting and ending at `vertices[0]`) as an open path with a
 * quarter arc of `radius` into its start and one out of its end, tangent to
 * it and curving away to the waste side: `waste` is which side of the
 * direction of travel it's on (outside an outside profile's outline, inside
 * its holes). The leads are true arcs (a vertex each, see
 * `src/cam/arcs.ts`); the loop's own vertices are kept as they are, but a
 * loop starting at a corner starts half-way along a side instead: an arc
 * along a side running into a corner would cross the next side (into an
 * inside corner's wall).
 */
export function withLeads(
  loop: CamVertex[],
  waste: 'left' | 'right',
  radius: number,
): CamVertex[] {
  const vertices = startOnSide(loop, radius);
  const n = vertices.length;
  const p0 = vertices[0];
  const wasteOnRight = waste === 'right';
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

/** Directions closer than this (radians) make no corner. */
const SMOOTH = 1e-3;

/**
 * The loop starting at `vertices[0]`, or, when that's a corner, half-way
 * along a side: the one leaving it, or the one arriving, when long enough
 * for a lead of `radius` either way; else the longest.
 */
function startOnSide(vertices: CamVertex[], radius: number): CamVertex[] {
  const n = vertices.length;
  if (n < 2) return vertices;
  const at = (i: number) => vertices[((i % n) + n) % n];
  const tangent = (i: number, t: 0 | 1) =>
    tangentAt(at(i), at(i + 1), bulgeOf(at(i)), t);
  const tIn = tangent(n - 1, 1);
  const tOut = tangent(0, 0);
  const turn = Math.abs(
    Math.atan2(
      tIn.x * tOut.y - tIn.y * tOut.x,
      tIn.x * tOut.x + tIn.y * tOut.y,
    ),
  );
  if (turn < SMOOTH) return vertices;

  const length = (i: number) => segmentLength(at(i), at(i + 1), bulgeOf(at(i)));
  let side = [0, n - 1].find((i) => length(i) >= 2 * radius);
  if (side === undefined) {
    side = 0;
    for (let i = 1; i < n; i++) {
      if (length(i) > length(side)) side = i;
    }
  }
  // Split that side in two halves (an arc's halves each sweep half as far)
  // and start at the middle.
  const a = at(side);
  const b = at(side + 1);
  const bulge = bulgeOf(a);
  const half = bulge ? Math.tan(Math.atan(bulge) / 2) : 0;
  const middle = { ...pointAlong(a, b, bulge, 0.5), bulge: half };
  const rest = Array.from({ length: n }, (_, k) => at(side + 1 + k));
  return [
    middle,
    ...rest.slice(0, n - 1),
    bulge ? { ...a, bulge: half } : withoutBulge(a),
  ];
}

function withoutBulge({ bulge: _, ...point }: CamVertex): CamVertex {
  return point;
}
