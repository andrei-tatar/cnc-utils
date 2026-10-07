import {
  bulgeOf,
  pointAlong,
  segmentLength,
  signedArea,
  sweepOf,
  tangentAt,
} from './arcs';
import { containingPolygons } from './polygon-nesting';
import { CamPoint, CamPolygon, CamVertex } from './types';

/** A vertex where a polygon turns. */
export type Corner = {
  /** Index of the vertex in its (cleaned) polygon. */
  index: number;
  point: CamPoint;
  /** Unit vectors from the corner along its edges. */
  toPrev: CamPoint;
  toNext: CamPoint;
  lengthPrev: number;
  lengthNext: number;
  /**
   * Angle between the edges, in radians: π for a straight run, smaller the
   * sharper the corner (whichever side it's seen from).
   */
  angle: number;
  /**
   * For a closed polygon: whether the corner points out of the filled
   * region (a shape's outside corner, a hole's inside one). Null on open
   * paths, which fill nothing.
   */
  convex: boolean | null;
  /**
   * Unit vector halfway between the edges, on the side the angle opens to
   * (into the filled region for a convex corner, out of it for a concave
   * one).
   */
  bisector: CamPoint;
};

/** A polygon without repeated vertices, with its corners. */
export type CornerPolygon = {
  vertices: CamVertex[];
  close: boolean;
  corners: Corner[];
};

/** Corners closer to straight than this (radians) aren't corners. */
const STRAIGHT = 1e-6;

/**
 * The corners of every polygon: vertices where the direction changes
 * (smooth joins of arcs and lines aren't corners). Closed polygons are
 * taken together, by even-odd nesting (as pockets and profiles see them),
 * to know which side of each one is filled.
 */
export function findCorners(polygons: CamPolygon[]): CornerPolygon[] {
  const cleaned = polygons.map((p) => ({
    vertices: withoutRepeats(p.vertices, p.close),
    close: p.close,
  }));
  const closed = cleaned
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.close && p.vertices.length > 1);
  const parents = containingPolygons(closed.map(({ p }) => p));
  const filledOnLeft = new Map<number, boolean>();
  closed.forEach(({ p, i }, k) => {
    const isHole = parents[k].length % 2 === 1;
    filledOnLeft.set(i, signedArea(p) > 0 !== isHole);
  });

  return cleaned.map((polygon, i) => ({
    ...polygon,
    corners: polygonCorners(polygon, filledOnLeft.get(i)),
  }));
}

function polygonCorners(
  polygon: CamPolygon,
  filledOnLeft: boolean | undefined,
): Corner[] {
  const { vertices, close } = polygon;
  const n = vertices.length;
  const corners: Corner[] = [];
  if (n < 2 || (n < 3 && !close)) return corners;
  for (let i = close ? 0 : 1; i < (close ? n : n - 1); i++) {
    const point = vertices[i];
    const prev = vertices[(i - 1 + n) % n];
    const next = vertices[(i + 1) % n];
    const prevBulge = bulgeOf(prev);
    const nextBulge = bulgeOf(point);
    const lengthPrev = segmentLength(prev, point, prevBulge);
    const lengthNext = segmentLength(point, next, nextBulge);
    if (!lengthPrev || !lengthNext) continue;
    const arriving = tangentAt(prev, point, prevBulge, 1);
    const toPrev = { x: -arriving.x, y: -arriving.y };
    const toNext = tangentAt(point, next, nextBulge, 0);
    const cross = toNext.x * toPrev.y - toNext.y * toPrev.x;
    const dot = toNext.x * toPrev.x + toNext.y * toPrev.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (Math.PI - angle < STRAIGHT) continue;

    // Turning counter-clockwise from the next edge to the previous one
    // sweeps the left side of the path.
    const leftIsSharp = cross > 0;
    const convex =
      filledOnLeft === undefined ? null : leftIsSharp === filledOnLeft;
    const half = { x: toPrev.x + toNext.x, y: toPrev.y + toNext.y };
    const halfLength = Math.hypot(half.x, half.y);
    corners.push({
      index: i,
      point: { x: point.x, y: point.y },
      toPrev,
      toNext,
      lengthPrev,
      lengthNext,
      angle,
      convex,
      bisector:
        halfLength > 1e-12
          ? { x: half.x / halfLength, y: half.y / halfLength }
          : { x: -toNext.y, y: toNext.x },
    });
  }
  return corners;
}

function withoutRepeats(vertices: CamVertex[], close: boolean): CamVertex[] {
  const result: CamVertex[] = [];
  for (const v of vertices) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(v.x - last.x, v.y - last.y) > 1e-9) {
      result.push(v);
    } else {
      // A zero-length segment: the later vertex's bulge goes on.
      result[result.length - 1] = v;
    }
  }
  if (close && result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) {
      result.pop();
    }
  }
  return result;
}

export type CornerSelection = {
  /** Which corners of filled shapes (open paths count as both). */
  which: 'all' | 'convex' | 'concave';
  /** Only corners at least this sharp (radians between the edges). */
  maxAngle: number;
};

export function isSelected(corner: Corner, selection: CornerSelection) {
  if (corner.angle > selection.maxAngle) return false;
  if (selection.which === 'all' || corner.convex === null) return true;
  return selection.which === 'convex' ? corner.convex : !corner.convex;
}

/**
 * Rounds (`fillet`, an arc) or bevels (`chamfer`) the selected corners: a
 * fillet of radius `size`, or a chamfer `size` mm along each edge. Where the
 * edges are too short, the corner is cut back to half of the shorter one.
 * Edges are trimmed along themselves (arcs stay arcs); a fillet's centre is
 * set from the edges' directions at the corner, exact between lines.
 */
export function roundCorners(
  polygon: CornerPolygon,
  mode: 'fillet' | 'chamfer',
  size: number,
  selection: CornerSelection,
): CamPolygon {
  const { vertices, close } = polygon;
  const n = vertices.length;
  const segments = close ? n : n - 1;
  // How much of each segment is cut off at its start and end.
  const trimStart = new Array<number>(n).fill(0);
  const trimEnd = new Array<number>(n).fill(0);
  const rounded = new Map<number, { corner: Corner; trim: number }>();
  for (const corner of polygon.corners) {
    if (size <= 0 || !isSelected(corner, selection)) continue;
    const tanHalf = Math.tan(corner.angle / 2);
    const wanted = mode === 'fillet' ? size / tanHalf : size;
    const trim = Math.min(wanted, corner.lengthPrev / 2, corner.lengthNext / 2);
    if (!(trim > 0)) continue;
    rounded.set(corner.index, { corner, trim });
    trimStart[corner.index] = trim;
    trimEnd[(corner.index - 1 + n) % n] = trim;
  }
  const length = (i: number) =>
    segmentLength(vertices[i], vertices[(i + 1) % n], bulgeOf(vertices[i]));
  // The part of segment i left after trimming, as a vertex at its start.
  const remaining = (i: number): CamVertex => {
    const a = vertices[i];
    if (i >= segments) return { x: a.x, y: a.y };
    const b = vertices[(i + 1) % n];
    const bulge = bulgeOf(a);
    const l = length(i);
    const t0 = l ? trimStart[i] / l : 0;
    const t1 = l ? 1 - trimEnd[i] / l : 1;
    const start = pointAlong(a, b, bulge, t0);
    return bulge
      ? { ...start, bulge: Math.tan(((t1 - t0) * sweepOf(bulge)) / 4) }
      : start;
  };
  const out: CamVertex[] = [];
  for (let i = 0; i < n; i++) {
    const round = rounded.get(i);
    if (!round) {
      out.push(remaining(i));
      continue;
    }
    const { corner, trim } = round;
    const prev = (i - 1 + n) % n;
    const prevBulge = bulgeOf(vertices[prev]);
    const start = pointAlong(
      vertices[prev],
      vertices[i],
      prevBulge,
      1 - trim / length(prev),
    );
    // Turning left (the next edge counter-clockwise from the previous
    // one's direction) makes a counter-clockwise fillet.
    const arriving = { x: -corner.toPrev.x, y: -corner.toPrev.y };
    const turn = arriving.x * corner.toNext.y - arriving.y * corner.toNext.x;
    const bulge =
      mode === 'fillet'
        ? Math.sign(turn) * Math.tan((Math.PI - corner.angle) / 4)
        : 0;
    out.push(bulge ? { ...start, bulge } : start);
    out.push(remaining(i));
  }
  return { vertices: out, close };
}

/** A full circle, counter-clockwise: two half circles. */
export function circlePolygon(center: CamPoint, radius: number): CamPolygon {
  return {
    vertices: [
      { x: center.x - radius, y: center.y, bulge: 1 },
      { x: center.x + radius, y: center.y, bulge: 1 },
    ],
    close: true,
  };
}

export function along(point: CamPoint, direction: CamPoint, distance: number) {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}
