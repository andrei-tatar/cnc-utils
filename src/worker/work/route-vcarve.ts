import {
  DECIMALS,
  PRECISION,
  insetContours,
  carveRegion,
  holeSide,
  ShapePart,
  vCarveGeometry,
} from '../../cam/vcarve-geometry';
import { CamPoint, CamPoint3, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { getDistance } from '../../util';
import {
  distanceToBoundary,
  nestContours,
  pointInPolygon,
} from '../../cam/polygon-nesting';

/**
 * V-carve by successive inward offsets. A V-bit whose center sits `d` inside
 * the outline must be at the depth where its cone radius equals `d` for the
 * cutting edge to touch the outline at the surface. Cutting every inset
 * contour at its matching depth sweeps out the V-groove: walls land on the
 * outline and the deepest cut follows the shape's medial axis.
 *
 * Inset contours alone leave every convex corner rounded with a radius of
 * about one stepover. With `sharpCorners`, the bit also runs out along each
 * sharp corner's bisector, rising so its cone stays tangent to both edges,
 * then comes back down — that reaches into the corner and leaves a crisp
 * point at the surface.
 */
export async function routeVCarve(
  input: CamShape[],
  options: {
    toolSize: number;
    vAngle: number;
    tipDiameter: number;
    startDepth: number;
    maxDepth: number;
    stepover: number;
    clearFlatBottom: boolean;
    sharpCorners: boolean;
    sharpCornerAngle: number;
    /** The groove's middle is cleared first, so carve below the cone. */
    beyondCone?: boolean;
    /** Which part of the shape to carve. */
    mode?: ShapePart;
  },
): Promise<GCodeBuilder> {
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const geometry = vCarveGeometry(options);
  const stepover = Math.max(PRECISION, options.stepover);
  if (!geometry) {
    return builder;
  }
  const { tan, tipRadius, maxDepth, maxInset } = geometry;

  const depthAt = (inset: number) =>
    -(options.startDepth + Math.min(maxDepth, (inset - tipRadius) / tan));

  let position: CamPoint = { x: 0, y: 0 };

  // Open paths have no width to derive a depth from: engrave them at max
  // depth. They aren't holes, so "holes only" leaves them out.
  const openPolylines =
    options.mode === 'holes'
      ? []
      : input
          .flatMap((s) => s.polygons)
          .filter((p) => !p.close && p.points.length > 1);

  for (const polyline of openPolylines) {
    const points =
      getDistance(position, polyline.points[0]) <=
      getDistance(position, polyline.points[polyline.points.length - 1])
        ? polyline.points
        : [...polyline.points].reverse();

    cutPath(builder, points, depthAt(maxInset));
    position = points[points.length - 1];
  }

  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.points.length > 2)
    .map((p) => p.points);

  if (!closed.length || maxDepth <= 0) {
    return builder;
  }

  const region = await carveRegion(closed, options.mode);

  // "Holes only" makes the same cuts as "outlines minus holes" but keeps just
  // the parts growing out from the holes.
  const keepAt: (inset: number) => ((p: CamPoint) => boolean) | null =
    options.mode === 'holes' ? await holeSide(closed) : () => null;

  const corners: CornerOptions | null = options.sharpCorners
    ? {
        maxAngle: (options.sharpCornerAngle * Math.PI) / 180,
        depthAt,
        maxInset,
        boundary: region,
      }
    : null;

  // Step size that lands exactly on the max-depth inset, so the walls reach
  // full depth before any flat-bottom clearing starts.
  const stepFrom = (inset: number) =>
    inset < maxInset - PRECISION
      ? Math.min(stepover, maxInset - inset)
      : stepover;

  const firstInset = tipRadius + stepFrom(tipRadius);
  const firstLevel = groupComponents(await insetContours(region, firstInset));

  // Depth-first over the inset tree: each island is carved all the way down
  // before moving on, which keeps travel short and lets every island get its
  // own collapse pass.
  const stack: Component[] = orderComponents(firstLevel, position)
    .map((contours) => ({ contours, inset: firstInset, fromInset: tipRadius }))
    .reverse();

  while (stack.length) {
    const { contours, inset, fromInset } = stack.pop()!;

    for (const contour of orderByProximity(contours, position)) {
      cutContour(
        builder,
        contour,
        inset,
        fromInset,
        depthAt,
        corners,
        keepAt(inset),
      );
      position = contour[0];
    }

    if (inset >= maxInset - PRECISION && !options.clearFlatBottom) {
      continue;
    }

    const step = stepFrom(inset);
    const next = await insetContours(contours, step);

    if (next.length) {
      const children = orderComponents(groupComponents(next), position);
      stack.push(
        ...children
          .map((contours) => ({
            contours,
            inset: inset + step,
            fromInset: inset,
          }))
          .reverse(),
      );
      continue;
    }

    // The island collapses somewhere within this step. Its deepest point (on
    // the medial axis) would otherwise be left as a ridge up to
    // `step / tan(angle / 2)` high, so find the last non-empty inset.
    const collapse = await findCollapse(contours, step);
    if (collapse) {
      const collapsed = groupComponents(collapse.contours).flat();
      for (const contour of orderByProximity(collapsed, position)) {
        cutContour(
          builder,
          contour,
          inset + collapse.inset,
          inset,
          depthAt,
          corners,
          keepAt(inset + collapse.inset),
        );
        position = contour[0];
      }
    }
  }

  return builder;
}

type Component = {
  contours: CamPoint[][];
  inset: number;
  /** Inset of the level this one was offset from (where corner runs end). */
  fromInset: number;
};

type CornerOptions = {
  /** Corners with an interior angle up to this (radians) get sharpened. */
  maxAngle: number;
  depthAt: (inset: number) => number;
  maxInset: number;
  /** The original outline, used to make sure a corner run never gouges it. */
  boundary: CamPoint[][];
};

async function findCollapse(contours: CamPoint[][], step: number) {
  let lo = 0;
  let hi = step;
  let found: CamPoint[][] | null = null;

  while (hi - lo > PRECISION) {
    const mid = (lo + hi) / 2;
    const inset = await insetContours(contours, mid);
    if (inset.length) {
      lo = mid;
      found = inset;
    } else {
      hi = mid;
    }
  }

  return found && lo > PRECISION ? { contours: found, inset: lo } : null;
}

/**
 * Split contours into islands: an outline plus the holes directly inside it.
 * A contour nested inside an odd number of others is a hole. Contours come
 * back oriented with the region on their left.
 */
function groupComponents(contours: CamPoint[][]): CamPoint[][][] {
  // Orient every contour so the material to remove lies on its left:
  // outlines counter-clockwise, holes clockwise.
  const orient = (contour: CamPoint[], counterClockwise: boolean) =>
    signedArea(contour) > 0 === counterClockwise
      ? contour
      : [...contour].reverse();

  return nestContours(contours).map(({ outer, holes }) => [
    orient(outer, true),
    ...holes.map((hole) => orient(hole, false)),
  ]);
}

function orderComponents(components: CamPoint[][][], start: CamPoint) {
  const remaining = [...components];
  const ordered: CamPoint[][][] = [];
  let position = start;

  while (remaining.length) {
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((component, i) => {
      for (const point of component[0]) {
        const distance = getDistance(position, point);
        if (distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
    });
    const [component] = remaining.splice(best, 1);
    ordered.push(component);
    position = component[0][0];
  }

  return ordered;
}

/**
 * Greedy nearest-neighbour ordering; each loop is rotated to start at the
 * vertex closest to where the previous one ended.
 */
function orderByProximity(contours: CamPoint[][], start: CamPoint) {
  const remaining = [...contours];
  const ordered: CamPoint[][] = [];
  let position = start;

  while (remaining.length) {
    let best = { contour: 0, point: 0, distance: Infinity };
    remaining.forEach((contour, c) =>
      contour.forEach((point, p) => {
        const distance = getDistance(position, point);
        if (distance < best.distance) {
          best = { contour: c, point: p, distance };
        }
      }),
    );

    const [contour] = remaining.splice(best.contour, 1);
    const rotated = [
      ...contour.slice(best.point),
      ...contour.slice(0, best.point),
    ];
    ordered.push(rotated);
    position = rotated[0];
  }

  return ordered;
}

function cutPath(builder: GCodeBuilder, points: CamPoint[], depth: number) {
  builder.goToSafeHeight();
  builder.travelTo(points[0].x, points[0].y);
  builder.plunge(depth);
  for (let i = 1; i < points.length; i++) {
    builder.carveTo(points[i].x, points[i].y);
  }
}

/**
 * Cut one closed inset contour at the depth for `inset`. At each sharp convex
 * corner, run out along the bisector to where the previous level (`fromInset`)
 * had that corner, rising to its depth, and come back. The contour must have
 * the region on its left (see `groupComponents`). With `keep`, only the parts
 * of the contour where it holds are cut.
 */
function cutContour(
  builder: GCodeBuilder,
  contour: CamPoint[],
  inset: number,
  fromInset: number,
  depthAt: (inset: number) => number,
  corners: CornerOptions | null,
  keep: ((p: CamPoint) => boolean) | null = null,
) {
  const kept = contour.map((p) => !keep || keep(p));
  const n = contour.length;
  // Start where a kept stretch begins (none: nothing to cut).
  const first = kept.every(Boolean)
    ? 0
    : kept.findIndex((k, i) => k && !kept[(i - 1 + n) % n]);
  if (first < 0) {
    return;
  }
  contour = [...contour.slice(first), ...contour.slice(0, first)];
  kept.push(...kept.splice(0, first));

  const depth = depthAt(inset);
  const startAt = (p: CamPoint) => {
    builder.goToSafeHeight();
    builder.travelTo(p.x, p.y);
    builder.plunge(depth);
  };
  // How far the edge from kept `a` towards dropped `b` stays kept.
  const lastKept = (a: CamPoint, b: CamPoint) => {
    const at = (t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * getDistance(a, b) > PRECISION) {
      const mid = (lo + hi) / 2;
      if (keep!(at(mid))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return at(lo);
  };

  if (kept[n - 1]) {
    startAt(contour[0]);
  } else {
    const entry = lastKept(contour[0], contour[n - 1]);
    startAt(entry);
    builder.carveTo(contour[0].x, contour[0].y);
  }

  for (let i = 0; i < n; i++) {
    const vertex = contour[i];
    const next = contour[(i + 1) % n];
    const nextKept = kept[(i + 1) % n];

    if (!kept[i]) {
      // Resume where the edge to the next kept point comes back in.
      if (nextKept) {
        startAt(lastKept(next, vertex));
        builder.carveTo(next.x, next.y);
      }
      continue;
    }

    const run = corners
      ? cornerRun(
          neighbour(contour, i, -1),
          vertex,
          neighbour(contour, i, 1),
          inset,
          fromInset,
          corners,
        )
      : null;

    if (run) {
      for (const p of [...run, ...run.slice(0, -1).reverse()]) {
        builder.carveTo(p.x, p.y, p.z);
      }
      builder.carveTo(vertex.x, vertex.y, depth);
    }

    const end = nextKept ? next : lastKept(vertex, next);
    builder.carveTo(end.x, end.y);
  }
}

/**
 * Points (outward from the vertex) tracing a sharp corner's bisector from
 * `inset` back to `fromInset`, at the depth that keeps the cone touching both
 * edges. Null when the corner isn't sharp or the run would cut the outline.
 */
function cornerRun(
  prev: CamPoint,
  vertex: CamPoint,
  next: CamPoint,
  inset: number,
  fromInset: number,
  corners: CornerOptions,
): CamPoint3[] | null {
  if (inset - fromInset <= PRECISION) {
    return null;
  }

  const a = unit(prev.x - vertex.x, prev.y - vertex.y);
  const b = unit(next.x - vertex.x, next.y - vertex.y);
  if (!a || !b) {
    return null;
  }

  // Region on the left: a left turn is a convex corner of the region.
  const turn =
    (vertex.x - prev.x) * (next.y - vertex.y) -
    (vertex.y - prev.y) * (next.x - vertex.x);
  const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
  if (turn <= 0 || angle > corners.maxAngle) {
    return null;
  }

  // Bisector pointing into the corner (away from the region's interior).
  const out = unit(-(a.x + b.x), -(a.y + b.y));
  if (!out) {
    return null;
  }
  const sinHalf = Math.sin(angle / 2);
  const at = (t: number): CamPoint3 => {
    const along = (inset - t) / sinHalf;
    return {
      x: vertex.x + out.x * along,
      y: vertex.y + out.y * along,
      z: corners.depthAt(t),
    };
  };

  // The run is only valid while those two edges are the nearest boundary: a
  // point at inset `t` along it must be inside the outline and exactly `t`
  // from it. That rejects nearby features (e.g. a small island in the corner)
  // and spurious spikes on nearly-collapsed contours.
  // The end may lie on the outline itself (sharp tip, first level), so
  // insideness is only required there when it's meant to be off the outline.
  const samples = [0.25, 0.5, 0.75, 1].map(
    (f) => inset - (inset - fromInset) * f,
  );
  const isValid = samples.every(
    (t) =>
      Math.abs(distanceToBoundary(at(t), corners.boundary) - t) <=
        3 * PRECISION &&
      (t <= 3 * PRECISION || insideRegion(at(t), corners.boundary)),
  );
  if (!isValid) {
    return null;
  }

  // Depth is linear in the inset until it clamps at max depth: add the kink.
  const ts =
    fromInset < corners.maxInset && corners.maxInset < inset
      ? [corners.maxInset, fromInset]
      : [fromInset];
  return ts.map(at);
}

/**
 * The nearest vertex in `direction` at least a few precision steps away, so
 * micro-edges from coordinate rounding don't fake (or hide) a sharp corner.
 */
function neighbour(contour: CamPoint[], i: number, direction: 1 | -1) {
  const n = contour.length;
  for (let k = 1; k < n; k++) {
    const candidate = contour[(i + direction * k + n * k) % n];
    if (getDistance(contour[i], candidate) >= 5 * PRECISION) {
      return candidate;
    }
  }
  return contour[(i + direction + n) % n];
}

function unit(x: number, y: number): CamPoint | null {
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / length, y: y / length } : null;
}

function insideRegion(point: CamPoint, region: CamPoint[][]) {
  return region.filter((c) => pointInPolygon(point, c)).length % 2 === 1;
}

function signedArea(points: CamPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
