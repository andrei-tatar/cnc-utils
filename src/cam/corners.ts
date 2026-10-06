import { containingContours, signedArea2 } from './polygon-nesting';
import { CamPoint, CamPolygon } from './types';

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

/** A polygon without repeated points, with its corners. */
export type CornerPolygon = {
  points: CamPoint[];
  close: boolean;
  corners: Corner[];
};

/** Corners closer to straight than this (radians) aren't corners. */
const STRAIGHT = 1e-6;

/**
 * The corners of every polygon. Closed polygons are taken together, by
 * even-odd nesting (as pockets and profiles see them), to know which side
 * of each one is filled.
 */
export function findCorners(polygons: CamPolygon[]): CornerPolygon[] {
  const cleaned = polygons.map((p) => ({
    points: withoutRepeats(p.points, p.close),
    close: p.close,
  }));
  const closed = cleaned
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.close && p.points.length > 2);
  const parents = containingContours(closed.map(({ p }) => p.points));
  const filledOnLeft = new Map<number, boolean>();
  closed.forEach(({ p, i }, k) => {
    const isHole = parents[k].length % 2 === 1;
    filledOnLeft.set(i, signedArea2(p.points) > 0 !== isHole);
  });

  return cleaned.map((polygon, i) => ({
    ...polygon,
    corners: polygonCorners(polygon.points, polygon.close, filledOnLeft.get(i)),
  }));
}

function polygonCorners(
  points: CamPoint[],
  close: boolean,
  filledOnLeft: boolean | undefined,
): Corner[] {
  const n = points.length;
  const corners: Corner[] = [];
  if (n < 3) return corners;
  for (let i = close ? 0 : 1; i < (close ? n : n - 1); i++) {
    const point = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const lengthPrev = Math.hypot(prev.x - point.x, prev.y - point.y);
    const lengthNext = Math.hypot(next.x - point.x, next.y - point.y);
    const toPrev = {
      x: (prev.x - point.x) / lengthPrev,
      y: (prev.y - point.y) / lengthPrev,
    };
    const toNext = {
      x: (next.x - point.x) / lengthNext,
      y: (next.y - point.y) / lengthNext,
    };
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
      point,
      toPrev,
      toNext,
      lengthPrev,
      lengthNext,
      angle,
      convex,
      bisector: { x: half.x / halfLength, y: half.y / halfLength },
    });
  }
  return corners;
}

function withoutRepeats(points: CamPoint[], close: boolean): CamPoint[] {
  const result: CamPoint[] = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) {
      result.push(p);
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
 * Rounds (`fillet`) or bevels (`chamfer`) the selected corners: a fillet of
 * radius `size`, or a chamfer `size` mm along each edge. Where the edges are
 * too short, the corner is cut back to half of the shorter one.
 */
export function roundCorners(
  polygon: CornerPolygon,
  mode: 'fillet' | 'chamfer',
  size: number,
  selection: CornerSelection,
  curveTolerance: number,
): CamPolygon {
  const byIndex = new Map(polygon.corners.map((c) => [c.index, c]));
  const points: CamPoint[] = [];
  polygon.points.forEach((point, i) => {
    const corner = byIndex.get(i);
    if (!corner || size <= 0 || !isSelected(corner, selection)) {
      points.push(point);
      return;
    }
    const tanHalf = Math.tan(corner.angle / 2);
    const wanted = mode === 'fillet' ? size / tanHalf : size;
    const trim = Math.min(wanted, corner.lengthPrev / 2, corner.lengthNext / 2);
    const start = along(point, corner.toPrev, trim);
    const end = along(point, corner.toNext, trim);
    if (mode === 'chamfer') {
      points.push(start, end);
      return;
    }
    const radius = trim * tanHalf;
    const center = along(
      point,
      corner.bisector,
      trim / Math.cos(corner.angle / 2),
    );
    points.push(...arcPoints(center, radius, start, end, curveTolerance));
  });
  return { points, close: polygon.close };
}

/** Points from `start` to `end` (both included) around `center`, the short way. */
export function arcPoints(
  center: CamPoint,
  radius: number,
  start: CamPoint,
  end: CamPoint,
  curveTolerance: number,
): CamPoint[] {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(sweep) / segmentAngle(radius, curveTolerance)),
  );
  const points = [start];
  for (let k = 1; k < steps; k++) {
    const a = a0 + (sweep * k) / steps;
    points.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    });
  }
  points.push(end);
  return points;
}

/** A full circle as a closed polygon, within `curveTolerance` of the curve. */
export function circlePolygon(
  center: CamPoint,
  radius: number,
  curveTolerance: number,
): CamPolygon {
  const steps = Math.max(
    8,
    Math.ceil((2 * Math.PI) / segmentAngle(radius, curveTolerance)),
  );
  const points: CamPoint[] = [];
  for (let k = 0; k < steps; k++) {
    const a = (2 * Math.PI * k) / steps;
    points.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    });
  }
  return { points, close: true };
}

/** The largest angle a chord can span and stay within the tolerance. */
function segmentAngle(radius: number, curveTolerance: number) {
  if (radius <= curveTolerance) return Math.PI / 2;
  return Math.min(Math.PI / 4, 2 * Math.acos(1 - curveTolerance / radius));
}

export function along(point: CamPoint, direction: CamPoint, distance: number) {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}
