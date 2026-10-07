import { pointAlong, polygonsBounds, windingNumber } from './arcs';
import { CamPoint, CamPolygon } from './types';

export type NestedContour = {
  outer: CamPoint[];
  /** Contours directly inside `outer` (not those inside a hole's island). */
  holes: CamPoint[][];
};

/**
 * Group closed, non-intersecting contours into outlines and their holes using
 * even-odd nesting: a contour inside an even number of others is an outline,
 * inside an odd number it's a hole of the innermost outline around it.
 * Islands inside holes become outlines of their own.
 */
export function nestContours(contours: CamPoint[][]): NestedContour[] {
  const parents = containingContours(contours);
  const depth = parents.map((p) => p.length);

  const nested = new Map<number, NestedContour>();
  contours.forEach((contour, i) => {
    if (depth[i] % 2 === 0) {
      nested.set(i, { outer: contour, holes: [] });
    }
  });
  contours.forEach((contour, i) => {
    if (depth[i] % 2 === 1) {
      const parent = parents[i].find((j) => depth[j] === depth[i] - 1);
      if (parent !== undefined) {
        nested.get(parent)?.holes.push(contour);
      }
    }
  });

  return [...nested.values()];
}

/**
 * For each contour, the contours it lies inside (by its first point). An
 * odd number of them makes it a hole.
 */
export function containingContours(contours: CamPoint[][]): number[][] {
  const boxes = contours.map(boundingBox);
  return contours.map((contour, i) =>
    contours.flatMap((other, j) =>
      j !== i &&
      contains(boxes[j], boxes[i]) &&
      pointInPolygon(contour[0], other)
        ? [j]
        : [],
    ),
  );
}

/** Twice the signed area: positive for counter-clockwise (Y up). */
export function signedArea2(points: CamPoint[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return sum;
}

export function pointInPolygon(point: CamPoint, polygon: CamPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boundingBox(points: CamPoint[]): Box {
  const box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const { x, y } of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

/** Cheap pre-check: a contour can only be inside another if its box is. */
function contains(outer: Box, inner: Box) {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/** Distance from `point` to the nearest edge of any of the contours. */
export function distanceToBoundary(point: CamPoint, boundary: CamPoint[][]) {
  let min = Infinity;
  for (const contour of boundary) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq > 0
          ? Math.max(
              0,
              Math.min(
                1,
                ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq,
              ),
            )
          : 0;
      min = Math.min(
        min,
        Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)),
      );
    }
  }
  return min;
}

/** An outline of lines and arcs, and the holes directly inside it. */
export type NestedPolygon = {
  outer: CamPolygon;
  holes: CamPolygon[];
};

/**
 * `nestContours` for polygons of lines and arcs: outlines and their holes
 * by even-odd nesting (closed polygons that don't cross each other).
 */
export function nestPolygons(polygons: CamPolygon[]): NestedPolygon[] {
  const parents = containingPolygons(polygons);
  const depth = parents.map((p) => p.length);
  const nested = new Map<number, NestedPolygon>();
  polygons.forEach((polygon, i) => {
    if (depth[i] % 2 === 0) {
      nested.set(i, { outer: polygon, holes: [] });
    }
  });
  polygons.forEach((polygon, i) => {
    if (depth[i] % 2 === 1) {
      const parent = parents[i].find((j) => depth[j] === depth[i] - 1);
      if (parent !== undefined) {
        nested.get(parent)?.holes.push(polygon);
      }
    }
  });
  return [...nested.values()];
}

/**
 * For each polygon, the polygons it lies inside (by its first vertex, nudged
 * along its first segment so a vertex shared with another polygon doesn't
 * decide). An odd number of them makes it a hole.
 */
export function containingPolygons(polygons: CamPolygon[]): number[][] {
  const boxes = polygons.map((p) => polygonsBounds([p]));
  return polygons.map((polygon, i) => {
    if (!polygon.vertices.length) return [];
    const probe = probePoint(polygon);
    return polygons.flatMap((other, j) =>
      j !== i &&
      other.close &&
      contains(boxes[j], boxes[i]) &&
      windingNumber(probe, [other]) !== 0
        ? [j]
        : [],
    );
  });
}

/** A point on the polygon: its first segment's middle. */
function probePoint(polygon: CamPolygon): CamPoint {
  const v = polygon.vertices;
  if (v.length < 2) return v[0];
  return pointAlong(v[0], v[1], v[0].bulge ?? 0, 0.5);
}

/** Whether `point` is inside the closed polygons (even-odd). */
export function insidePolygons(point: CamPoint, polygons: CamPolygon[]) {
  let inside = false;
  for (const p of polygons) {
    if (p.close && windingNumber(point, [p]) !== 0) inside = !inside;
  }
  return inside;
}
