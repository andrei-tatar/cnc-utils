import { closestOnSegment, fromPoints } from './arcs';
import { CamPoint, CamPolygon, CamVertex } from './types';

/**
 * The points without those within `epsilon` of the line between the points
 * kept around them (Ramer–Douglas–Peucker): the points kept don't move, and
 * the path stays within `epsilon` of where it was. A closed path is split
 * at its first point and the point furthest from it.
 */
export function simplifyPoints(
  points: CamPoint[],
  epsilon: number,
  closed: boolean,
): CamPoint[] {
  const n = points.length;
  if (n < (closed ? 4 : 3) || !(epsilon > 0)) {
    return points;
  }
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  const spans: [number, number][] = [];
  if (closed) {
    let far = 0;
    points.forEach((p, i) => {
      if (dist(p, points[0]) > dist(points[far], points[0])) far = i;
    });
    keep[far] = true;
    spans.push([0, far], [far, n]);
  } else {
    keep[n - 1] = true;
    spans.push([0, n - 1]);
  }
  while (spans.length) {
    const [from, to] = spans.pop()!;
    let worst = -1;
    let worstDistance = epsilon;
    for (let i = from + 1; i < to; i++) {
      const d = closestOnSegment(
        points[i],
        points[from],
        points[to % n],
      ).distance;
      if (d > worstDistance) {
        worst = i;
        worstDistance = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      spans.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function dist(a: CamPoint, b: CamPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * `simplifyPoints` for a polygon of lines and arcs: arcs are kept as they
 * are, and each run of straight segments between them is simplified with
 * its ends fixed.
 */
export function simplifyPolygon(
  polygon: CamPolygon,
  epsilon: number,
): CamPolygon {
  const { vertices, close } = polygon;
  if (!vertices.some((v) => v.bulge)) {
    return fromPoints(simplifyPoints(vertices, epsilon, close), close);
  }
  const n = vertices.length;
  // Fixed: vertices an arc starts or ends at.
  const fixed = vertices.map(
    (v, i) =>
      !!v.bulge || (i > 0 || close ? !!vertices[(i - 1 + n) % n].bulge : false),
  );
  if (!close) {
    fixed[0] = fixed[n - 1] = true;
  }
  // Start at a fixed vertex, so runs don't wrap round the end.
  const first = fixed.indexOf(true);
  const order = Array.from({ length: n }, (_, k) => (first + k) % n);
  const kept: CamVertex[] = [];
  let run: CamVertex[] = [];
  const flush = (end: CamVertex | null) => {
    if (!run.length) return;
    const points = end ? [...run, end] : run;
    const simple = simplifyPoints(points, epsilon, false);
    kept.push(...(end ? simple.slice(0, -1) : simple));
    run = [];
  };
  for (const i of order) {
    const v = vertices[i];
    if (fixed[i]) {
      flush(v);
      if (v.bulge) {
        kept.push(v);
      } else {
        run = [v];
      }
    } else {
      run.push(v);
    }
  }
  flush(close ? vertices[first] : null);
  return { vertices: kept, close };
}
