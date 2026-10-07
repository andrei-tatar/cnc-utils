import { CamPoint } from '../../src/cam/types';

/** Lines standing in for arcs stray no further than this (mm). */
const TOLERANCE = 0.001;

type Polygon = {
  close: boolean;
  /** Before arcs (the baseline's code). */
  points?: CamPoint[];
  /** Lines and arcs: each vertex's bulge shapes the segment to the next. */
  vertices?: Array<CamPoint & { bulge?: number }>;
};

/**
 * A polygon's outline as points, the harness comparing points: arcs
 * approximated by lines within TOLERANCE. Self-contained, so it works on
 * the code before polygons had arcs too.
 */
export function outlinePoints(polygon: Polygon): CamPoint[] {
  if (polygon.points) {
    return polygon.points;
  }
  const vertices = polygon.vertices ?? [];
  const points: CamPoint[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    points.push({ x: a.x, y: a.y });
    const last = i === n - 1;
    if (last && !polygon.close) break;
    const b = vertices[(i + 1) % n];
    if (a.bulge) {
      points.push(...arcInterior(a, b, a.bulge));
    }
  }
  return points;
}

/** Points strictly between `a` and `b` along the arc. */
function arcInterior(a: CamPoint, b: CamPoint, bulge: number): CamPoint[] {
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!chord) return [];
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  const h = chord / 2 / Math.tan(sweep / 2);
  const center = {
    x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * h,
    y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * h,
  };
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const step =
    radius > TOLERANCE ? 2 * Math.acos(1 - TOLERANCE / radius) : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const out: CamPoint[] = [];
  for (let k = 1; k < n; k++) {
    const angle = start + (sweep * k) / n;
    out.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return out;
}
