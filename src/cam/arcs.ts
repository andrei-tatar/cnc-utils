import { CamPoint, CamPolygon, CamVertex } from './types';

/**
 * Polygons are made of straight lines and circular arcs: each vertex's
 * `bulge` shapes the segment to the next one (the closing segment for the
 * last vertex of a closed polygon). No bulge (or 0) is a line; otherwise
 * it's `tan(sweep / 4)`, the sweep positive counter-clockwise: 1 is a half
 * circle bulging to the right of the direction of travel (turning left
 * round its centre), -1 one bulging to the left.
 */

/** Lines standing in for arcs stray no further than this by default (mm). */
export const DEFAULT_TOLERANCE = 0.01;

export type Arc = {
  center: CamPoint;
  radius: number;
  /** Angle of the start point from the center. */
  start: number;
  /** Signed sweep (positive counter-clockwise), within ±2π. */
  sweep: number;
};

export const bulgeOf = (v: CamVertex) => v.bulge ?? 0;

export const sweepOf = (bulge: number) => 4 * Math.atan(bulge);

export const bulgeForSweep = (sweep: number) => Math.tan(sweep / 4);

/** The circle of the arc from `a` to `b` with `bulge` (not 0). */
export function arcOf(a: CamPoint, b: CamPoint, bulge: number): Arc {
  const sweep = sweepOf(bulge);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // The centre sits off the chord's middle, to the left for a
  // counter-clockwise arc under a half turn.
  const h = chord / 2 / Math.tan(sweep / 2);
  const center = {
    x: (a.x + b.x) / 2 - (dy / chord) * h,
    y: (a.y + b.y) / 2 + (dx / chord) * h,
  };
  return {
    center,
    radius,
    start: Math.atan2(a.y - center.y, a.x - center.x),
    sweep,
  };
}

/** The arc through `a` and `b` around `center`, the way `ccw` says. */
export function bulgeAround(
  a: CamPoint,
  b: CamPoint,
  center: CamPoint,
  ccw: boolean,
): number {
  const a0 = Math.atan2(a.y - center.y, a.x - center.x);
  const a1 = Math.atan2(b.y - center.y, b.x - center.x);
  let sweep = a1 - a0;
  if (ccw) {
    while (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    while (sweep >= 0) sweep -= 2 * Math.PI;
  }
  return bulgeForSweep(sweep);
}

export function segmentLength(a: CamPoint, b: CamPoint, bulge = 0): number {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge || chord === 0) {
    return chord;
  }
  const sweep = Math.abs(sweepOf(bulge));
  return (sweep * chord) / (2 * Math.sin(sweep / 2));
}

/** The point `t` (0 to 1) of the way along the segment. */
export function pointAlong(
  a: CamPoint,
  b: CamPoint,
  bulge: number,
  t: number,
): CamPoint {
  if (!bulge) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const arc = arcOf(a, b, bulge);
  const angle = arc.start + arc.sweep * t;
  return {
    x: arc.center.x + arc.radius * Math.cos(angle),
    y: arc.center.y + arc.radius * Math.sin(angle),
  };
}

/** Unit direction of travel at the start (t 0) or end (t 1) of a segment. */
export function tangentAt(
  a: CamPoint,
  b: CamPoint,
  bulge: number,
  t: 0 | 1,
): CamPoint {
  if (!bulge) {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }
  const arc = arcOf(a, b, bulge);
  const angle = arc.start + arc.sweep * t;
  const s = Math.sign(arc.sweep);
  return { x: -Math.sin(angle) * s, y: Math.cos(angle) * s };
}

/** How many lines stand in for the arc (`tolerance` mm off it at most). */
export function arcSteps(
  radius: number,
  sweep: number,
  tolerance = DEFAULT_TOLERANCE,
): number {
  if (!(radius > tolerance)) {
    return Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  }
  const step = 2 * Math.acos(1 - tolerance / radius);
  return Math.max(1, Math.ceil(Math.abs(sweep) / step));
}

/**
 * Points along the segment from `a` to `b`, `a` left out and `b` included:
 * just `b` for a line.
 */
export function segmentPoints(
  a: CamPoint,
  b: CamPoint,
  bulge = 0,
  tolerance = DEFAULT_TOLERANCE,
): CamPoint[] {
  if (!bulge) {
    return [{ x: b.x, y: b.y }];
  }
  const arc = arcOf(a, b, bulge);
  const n = arcSteps(arc.radius, arc.sweep, tolerance);
  const points: CamPoint[] = [];
  for (let k = 1; k < n; k++) {
    const angle = arc.start + (arc.sweep * k) / n;
    points.push({
      x: arc.center.x + arc.radius * Math.cos(angle),
      y: arc.center.y + arc.radius * Math.sin(angle),
    });
  }
  points.push({ x: b.x, y: b.y });
  return points;
}

/**
 * The polygon as points only, arcs approximated by lines within
 * `tolerance`. A closed polygon's first point isn't repeated at the end.
 */
export function polygonPoints(
  polygon: CamPolygon,
  tolerance = DEFAULT_TOLERANCE,
): CamPoint[] {
  const { vertices, close } = polygon;
  if (!vertices.length) {
    return [];
  }
  const points: CamPoint[] = [{ x: vertices[0].x, y: vertices[0].y }];
  const n = vertices.length;
  for (let i = 0; i < n - 1; i++) {
    points.push(
      ...segmentPoints(
        vertices[i],
        vertices[i + 1],
        bulgeOf(vertices[i]),
        tolerance,
      ),
    );
  }
  if (close && n > 1 && bulgeOf(vertices[n - 1])) {
    points.push(
      ...segmentPoints(
        vertices[n - 1],
        vertices[0],
        bulgeOf(vertices[n - 1]),
        tolerance,
      ).slice(0, -1),
    );
  }
  return points;
}

/** A polygon of straight segments through `points`. */
export function fromPoints(points: CamPoint[], close: boolean): CamPolygon {
  return { vertices: points.map(({ x, y }) => ({ x, y })), close };
}

export function hasArcs(polygon: CamPolygon): boolean {
  return polygon.vertices.some((v) => !!v.bulge);
}

/** Calls `visit` for each segment (the closing one too, when closed). */
export function forEachSegment(
  polygon: CamPolygon,
  visit: (a: CamVertex, b: CamVertex, bulge: number, index: number) => void,
) {
  const { vertices, close } = polygon;
  const n = vertices.length;
  const count = close && n > 1 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    visit(vertices[i], vertices[(i + 1) % n], bulgeOf(vertices[i]), i);
  }
}

export function polygonLength(polygon: CamPolygon): number {
  let length = 0;
  forEachSegment(
    polygon,
    (a, b, bulge) => (length += segmentLength(a, b, bulge)),
  );
  return length;
}

/**
 * Signed area (positive counter-clockwise) of a closed polygon, each arc
 * adding the circular segment between it and its chord.
 */
export function signedArea(polygon: CamPolygon): number {
  if (!polygon.close) {
    return 0;
  }
  let area = 0;
  forEachSegment(polygon, (a, b, bulge) => {
    area += (a.x * b.y - b.x * a.y) / 2;
    if (bulge) {
      const { radius, sweep } = arcOf(a, b, bulge);
      area += ((radius * radius) / 2) * (sweep - Math.sin(sweep));
    }
  });
  return area;
}

/** The arc's extreme points along x and y it passes through. */
function arcExtremes(a: CamPoint, b: CamPoint, bulge: number): CamPoint[] {
  const { center, radius, start, sweep } = arcOf(a, b, bulge);
  const points: CamPoint[] = [];
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2;
    let d = (angle - start) * Math.sign(sweep);
    d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (d < Math.abs(sweep)) {
      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }
  }
  return points;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Bounding box of polygons, arcs included (empty: infinite). */
export function polygonsBounds(polygons: CamPolygon[]): Bounds {
  const box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const add = (p: CamPoint) => {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  };
  for (const polygon of polygons) {
    polygon.vertices.forEach(add);
    forEachSegment(polygon, (a, b, bulge) => {
      if (bulge) arcExtremes(a, b, bulge).forEach(add);
    });
  }
  return box;
}

/** The polygon travelled the other way round. */
export function reversePolygon(polygon: CamPolygon): CamPolygon {
  const { vertices, close } = polygon;
  const n = vertices.length;
  if (n < 2) {
    return { vertices: vertices.map((v) => ({ ...v })), close };
  }
  // Vertex i of the result starts the segment that ran into the old
  // vertex: its bulge is that segment's, negated.
  const reversed: CamVertex[] = [];
  for (let k = 0; k < n; k++) {
    const old = vertices[n - 1 - k];
    const before = close ? vertices[(n - 2 - k + n) % n] : vertices[n - 2 - k];
    const bulge = before && (close || k < n - 1) ? -bulgeOf(before) : 0;
    reversed.push(
      bulge ? { x: old.x, y: old.y, bulge } : { x: old.x, y: old.y },
    );
  }
  return { vertices: reversed, close };
}

/** An affine map: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

/**
 * The polygon mapped by `m`. Arcs stay arcs under a similarity (rotation,
 * uniform scale, translation, reflection: a reflection reverses their
 * sweep); any other map turns circles into ellipses, so arcs are first
 * approximated by lines within `tolerance`.
 */
export function transformPolygon(
  polygon: CamPolygon,
  m: Affine,
  tolerance = DEFAULT_TOLERANCE,
): CamPolygon {
  const [a, b, c, d, e, f] = m;
  const map = (p: CamPoint) => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  });
  const det = a * d - b * c;
  const similar =
    Math.abs(a * a + b * b - (c * c + d * d)) <=
      1e-9 * (a * a + b * b + c * c + d * d) &&
    Math.abs(a * c + b * d) <= 1e-9 * (a * a + b * b + c * c + d * d);
  if (!hasArcs(polygon)) {
    return { vertices: polygon.vertices.map(map), close: polygon.close };
  }
  if (similar && det !== 0) {
    const flip = det < 0 ? -1 : 1;
    return {
      vertices: polygon.vertices.map((v) => {
        const p = map(v);
        return v.bulge ? { ...p, bulge: v.bulge * flip } : p;
      }),
      close: polygon.close,
    };
  }
  // The scale along the most stretched direction makes the lines stray
  // most: approximate finely enough for that.
  const stretch = Math.sqrt(Math.max(a * a + b * b, c * c + d * d)) || 1;
  const points = polygonPoints(polygon, tolerance / stretch);
  return { vertices: points.map(map), close: polygon.close };
}

/** Closest point on a segment to `p`, and how far it is. */
export function closestOnSegment(
  p: CamPoint,
  a: CamPoint,
  b: CamPoint,
  bulge = 0,
): { point: CamPoint; distance: number } {
  if (!bulge) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
  }
  const { center, radius, start, sweep } = arcOf(a, b, bulge);
  const angle = Math.atan2(p.y - center.y, p.x - center.x);
  let d = (angle - start) * Math.sign(sweep);
  d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (d <= Math.abs(sweep)) {
    const point = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
    return {
      point,
      distance: Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius),
    };
  }
  const da = Math.hypot(p.x - a.x, p.y - a.y);
  const db = Math.hypot(p.x - b.x, p.y - b.y);
  return da <= db
    ? { point: { x: a.x, y: a.y }, distance: da }
    : { point: { x: b.x, y: b.y }, distance: db };
}

/** Distance from `p` to the nearest edge of any of the polygons. */
export function distanceToPolygons(
  p: CamPoint,
  polygons: CamPolygon[],
): number {
  let best = Infinity;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 1) {
      const v = polygon.vertices[0];
      best = Math.min(best, Math.hypot(p.x - v.x, p.y - v.y));
    }
    forEachSegment(polygon, (a, b, bulge) => {
      best = Math.min(best, closestOnSegment(p, a, b, bulge).distance);
    });
  }
  return best;
}

/**
 * Winding number of the closed polygons around `p`, arcs included (a ray
 * to +x crossing each segment's pieces that are monotone in y).
 */
export function windingNumber(p: CamPoint, polygons: CamPolygon[]): number {
  let winding = 0;
  const line = (a: CamPoint, b: CamPoint) => {
    if (a.y <= p.y && p.y < b.y) {
      if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) winding++;
    } else if (b.y <= p.y && p.y < a.y) {
      if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) winding--;
    }
  };
  for (const polygon of polygons) {
    if (!polygon.close) continue;
    forEachSegment(polygon, (a, b, bulge) => {
      if (!bulge) {
        line(a, b);
        return;
      }
      const { center, radius, start, sweep } = arcOf(a, b, bulge);
      // Cut at the top and bottom, then each piece crosses like a curve
      // between its ends' heights.
      const cuts = [0, 1]
        .map((k) => {
          let d = ((k ? -1 : 1) * Math.PI) / 2 - start;
          d *= Math.sign(sweep);
          return ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        })
        .filter((d) => d > 1e-12 && d < Math.abs(sweep) - 1e-12)
        .sort((x, y) => x - y);
      let from = 0;
      let pa: CamPoint = a;
      for (const to of [...cuts, Math.abs(sweep)]) {
        const angle = start + Math.sign(sweep) * to;
        const pb =
          to === Math.abs(sweep)
            ? b
            : {
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
              };
        const mid = start + (Math.sign(sweep) * (from + to)) / 2;
        const up = pa.y <= p.y && p.y < pb.y;
        const down = pb.y <= p.y && p.y < pa.y;
        if (up || down) {
          const dy = p.y - center.y;
          const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
          const x = Math.cos(mid) >= 0 ? center.x + dx : center.x - dx;
          if (x > p.x) winding += up ? 1 : -1;
        }
        from = to;
        pa = pb;
      }
    });
  }
  return winding;
}

/** Where (0 to 1) `p`, a point on the segment, is along it. */
export function paramOnSegment(
  a: CamPoint,
  b: CamPoint,
  bulge: number,
  p: CamPoint,
): number {
  if (!bulge) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    return l2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
  }
  const { center, start, sweep } = arcOf(a, b, bulge);
  const angle = Math.atan2(p.y - center.y, p.x - center.x);
  let d = (angle - start) * Math.sign(sweep);
  d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Just before the start reads as nearly a full turn: that's the start.
  if (d > Math.abs(sweep) && d > Math.PI + Math.abs(sweep) / 2) return 0;
  return Math.max(0, Math.min(1, d / Math.abs(sweep)));
}

/** Unit direction of travel at `t` (0 to 1) along a segment. */
export function tangentAlong(
  a: CamPoint,
  b: CamPoint,
  bulge: number,
  t: number,
): CamPoint {
  if (!bulge) {
    return tangentAt(a, b, 0, 0);
  }
  const arc = arcOf(a, b, bulge);
  const angle = arc.start + arc.sweep * t;
  const s = Math.sign(arc.sweep);
  return { x: -Math.sin(angle) * s, y: Math.cos(angle) * s };
}

/**
 * Whether the polygon encloses an area: closed, and either three vertices
 * or more, or two joined by an arc (a circle, a D).
 */
export function isArea(polygon: CamPolygon): boolean {
  const { vertices, close } = polygon;
  return (
    close &&
    (vertices.length > 2 ||
      (vertices.length === 2 && vertices.some((v) => !!v.bulge)))
  );
}
