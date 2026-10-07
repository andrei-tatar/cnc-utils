import { InlayPlug, inlayPlugShape } from './inlay-plug';
import { combine, inflate } from './regions';
import {
  insetContours,
  carveRegion,
  holeSide,
  ShapePart,
  vCarveGeometry,
} from '../../cam/vcarve-geometry';
import { CamPoint, CamPoint3, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { AxisPoint, medialAxis } from '../../cam/medial-axis';
import { GeometrySettings, precision, useGeometry } from '../../cam/geometry';
import { getDistance } from '../../util';
import {
  distanceToBoundary,
  nestContours,
  pointInPolygon,
} from '../../cam/polygon-nesting';
import { enterCut } from '../../cam/ramp';
import { travelOrder } from '../../cam/travel-order';

/**
 * Gets the bit down to `to` at the start of `path` (from safe height):
 * plunging, or ramping down from `from` (where the material starts).
 */
type Enter = (
  path: CamPoint[],
  close: boolean,
  from: number,
  to: number,
  floor?: (along: number) => number,
) => void;

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
    /** Null: no limit, a pointed V everywhere. */
    maxDepth: number | null;
    /** Null: a single pass along the shape's centre line (medial axis). */
    stepover: number | null;
    clearFlatBottom: boolean;
    /**
     * With a stepover: finish with a pass along the shape's centre line
     * (medial axis), so its deepest line is cut however coarse the stepover.
     */
    centerLine?: boolean;
    sharpCorners: boolean;
    sharpCornerAngle: number;
    /** The groove's middle is cleared first, so carve below the cone. */
    beyondCone?: boolean;
    /** Which part of the shape to carve. */
    mode?: ShapePart;
    /** Ramp down into each cut at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
    /** Carve an inlay plug for the shape (see InlayPlug). */
    plug?: InlayPlug | null;
    /** How precisely to work (see GeometrySettings). */
    geometry?: GeometrySettings;
    /** Carve separate parts in the order that keeps travel short. */
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const optimizeTravel = options.optimizeTravel !== false;
  // An inlay plug: carve around the (mirrored) design instead, reaching
  // `shift` further at the surface (see inlayPlugShape).
  let shift = 0;
  if (options.plug) {
    input = await inlayPlugShape(input, options.plug);
    shift = Math.max(0, options.plug.grow);
  }
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const geometry = vCarveGeometry(options);
  if (!geometry) {
    return builder;
  }
  const { tan, tipRadius, maxDepth, maxInset } = geometry;

  const depthAt = (inset: number) =>
    -(options.startDepth + Math.min(maxDepth, (inset - tipRadius) / tan));
  const top = -options.startDepth;
  // How far down the level `fromInset` in already cleared above a contour
  // `inset` in: its cone's flank rises 1/tan per mm out from the flat tip.
  const clearedAbove = (inset: number, fromInset: number) =>
    Math.min(
      top,
      depthAt(fromInset) + Math.max(0, inset - fromInset - tipRadius) / tan,
    );

  const enter: Enter = (path, close, from, to, floor) => {
    builder.goToSafeHeight();
    // Whether a ramp is worth it depends on how wide the cut it starts is:
    // the cone's width at the depth it goes down, not the bit's full width.
    const width = Math.min(
      options.toolSize,
      2 * (tipRadius + Math.max(0, from - to) * tan),
    );
    enterCut(
      builder,
      path,
      close,
      from,
      to,
      options.rampAngle ?? null,
      width,
      Infinity,
      undefined,
      floor,
    );
  };

  let position: CamPoint = { x: 0, y: 0 };

  // Open paths have no width to derive a depth from: engrave them at max
  // depth. They aren't holes, so "holes only" leaves them out.
  const openPolylines =
    options.mode === 'holes'
      ? []
      : input
          .flatMap((s) => s.polygons)
          .filter((p) => !p.close && p.points.length > 1)
          .map((p) => p.points);
  const openPaths = optimizeTravel
    ? travelOrder(
        openPolylines.map((points) => {
          const ends = [points[0], points[points.length - 1]];
          return { starts: ends, end: (start: number) => ends[1 - start] };
        }),
        position,
      ).map(({ index, start }) =>
        start ? [...openPolylines[index]].reverse() : openPolylines[index],
      )
    : openPolylines;

  for (const points of openPaths) {
    cutPath(builder, points, top, depthAt(maxInset), enter);
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
  // Insets below are from the outline of `area`: the region, or the region
  // grown by `shift` for a plug.
  const area = shift > 0 ? await inflate(region, shift) : region;
  // The contours `inset` in, within the island `contours` (`fromInset` in).
  // Down to `shift` in, a plug's levels are the region grown by what's left
  // of it: insetting the level above would round off the corners where the
  // area wraps round the design, more at each level.
  const inside: Inside = async (contours, fromInset, inset) =>
    fromInset < shift
      ? combine(
          await insetContours(region, inset - shift),
          contours,
          'intersection',
        )
      : insetContours(contours, inset - fromInset);

  // "Holes only" makes the same cuts as "outlines minus holes" but keeps just
  // the parts growing out from the holes.
  const keepAt: (inset: number) => ((p: CamPoint) => boolean) | null =
    options.mode === 'holes' ? await holeSide(closed) : () => null;

  if (!(options.stepover && options.stepover > 0)) {
    await carveSinglePass(
      builder,
      region,
      shift,
      () => inside(area, 0, maxInset),
      geometry,
      depthAt,
      keepAt,
      enter,
      top,
      position,
      // Cutting into corners is how a single pass works: only how sharp a
      // corner must be applies.
      (options.sharpCornerAngle * Math.PI) / 180,
    );
    return builder;
  }
  const stepover = Math.max(precision(), options.stepover);

  const corners: CornerOptions | null = options.sharpCorners
    ? {
        maxAngle: (options.sharpCornerAngle * Math.PI) / 180,
        depthAt,
        maxInset,
        boundary: region,
        shift,
      }
    : null;

  // Step size that lands exactly on the max-depth inset, so the walls reach
  // full depth before any flat-bottom clearing starts.
  const stepFrom = (inset: number) =>
    inset < maxInset - precision()
      ? Math.min(stepover, maxInset - inset)
      : stepover;

  const firstInset = tipRadius + stepFrom(tipRadius);
  const firstLevel = groupComponents(await inside(area, 0, firstInset));

  // Depth-first over the inset tree: each island is carved all the way down
  // before moving on, which keeps travel short and lets every island get its
  // own collapse pass.
  const stack: Component[] = (
    optimizeTravel ? orderComponents(firstLevel, position) : firstLevel
  )
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
        enter,
        clearedAbove(inset, fromInset),
      );
      position = contour[0];
    }

    if (inset >= maxInset - precision() && !options.clearFlatBottom) {
      continue;
    }

    const step = stepFrom(inset);
    const next = await inside(contours, inset, inset + step);

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
    if (options.centerLine) {
      // The centre line pass below reaches the deepest point.
      continue;
    }

    // The island collapses somewhere within this step. Its deepest point (on
    // the medial axis) would otherwise be left as a ridge up to
    // `step / tan(angle / 2)` high, so find the last non-empty inset.
    const collapse = await findCollapse(contours, inset, step, inside);
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
          enter,
          clearedAbove(inset + collapse.inset, inset),
        );
        position = contour[0];
      }
    }
  }

  if (options.centerLine) {
    await carveAxis(
      builder,
      region,
      shift,
      geometry,
      depthAt,
      keepAt,
      enter,
      top,
      position,
      options.sharpCorners ? (options.sharpCornerAngle * Math.PI) / 180 : null,
    );
  }

  return builder;
}

/**
 * Carve in a single pass along the medial axis, each point at the depth for
 * its distance to the edges: the cone then touches the nearest edge, which
 * makes the whole V, sharp convex corners included (the axis runs into
 * them). Where the shape is wider than the max depth allows, the axis isn't
 * cut (it would groove the uncut middle); the walls there get one pass along
 * the max-depth inset instead.
 */
async function carveSinglePass(
  builder: GCodeBuilder,
  region: CamPoint[][],
  shift: number,
  /** The contours at the max depth. */
  deepest: () => Promise<CamPoint[][]>,
  geometry: { tipRadius: number; maxInset: number },
  depthAt: (inset: number) => number,
  keepAt: (inset: number) => ((p: CamPoint) => boolean) | null,
  enter: Enter,
  top: number,
  position: CamPoint,
  sharpCornerAngle: number,
) {
  const { maxInset } = geometry;
  position = await carveAxis(
    builder,
    region,
    shift,
    geometry,
    depthAt,
    keepAt,
    enter,
    top,
    position,
    sharpCornerAngle,
  );

  if (Number.isFinite(maxInset)) {
    for (const contour of orderByProximity(
      groupComponents(await deepest()).flat(),
      position,
    )) {
      cutContour(
        builder,
        contour,
        maxInset,
        maxInset,
        depthAt,
        null,
        keepAt(maxInset),
        enter,
        // The axis isn't cut where it's this wide: nothing above is cleared.
        top,
      );
      position = contour[0];
    }
  }
  return position;
}

/**
 * Cut the medial axis where the shape is no wider than the max depth allows,
 * each point at the depth for its distance to the edges (plus `shift`).
 * Branches into corners are kept for corners up to `sharpCornerAngle`
 * (null: none).
 */
async function carveAxis(
  builder: GCodeBuilder,
  region: CamPoint[][],
  shift: number,
  geometry: { tipRadius: number; maxInset: number },
  depthAt: (inset: number) => number,
  keepAt: (inset: number) => ((p: CamPoint) => boolean) | null,
  enter: Enter,
  top: number,
  position: CamPoint,
  sharpCornerAngle: number | null,
) {
  const { tipRadius, maxInset } = geometry;
  const limited = Number.isFinite(maxInset);
  const z = (d: number) => depthAt(Math.max(d, tipRadius));

  // The parts of the axis to cut: narrow enough (ending exactly at the max
  // depth inset), and on the holes' side for "holes only".
  const runs: AxisPoint[][] = [];
  for (const regionAxis of medialAxis(
    region,
    Math.max(0.1, 5 * precision()),
    sharpCornerAngle,
  )) {
    // A plug's insets count from `shift` outside the region (the cone then
    // reaches that much further at the surface).
    const axis = shift
      ? regionAxis.map((p) => ({ ...p, d: p.d + shift }))
      : regionAxis;
    let run: AxisPoint[] = [];
    // (A single point is a plunge: e.g. the centre of a circle.)
    const end = () => {
      if (run.length) runs.push(run);
      run = [];
    };
    for (let i = 0; i < axis.length; i++) {
      const p = axis[i];
      const narrow = !limited || p.d <= maxInset;
      if (narrow && (keepAt(p.d)?.(p) ?? true)) {
        const prev = axis[i - 1];
        if (!run.length && prev && limited && prev.d > maxInset) {
          run.push(crossing(prev, p, maxInset));
        }
        run.push(p);
      } else {
        const prev = axis[i - 1];
        if (run.length && limited && !narrow && prev && prev.d <= maxInset) {
          run.push(crossing(prev, p, maxInset));
        }
        end();
      }
    }
    end();
  }

  // Cut them nearest first, carrying straight on where one starts where the
  // last one ended.
  while (runs.length) {
    let best = 0;
    let reversed = false;
    let bestDistance = Infinity;
    runs.forEach((run, i) => {
      const toStart = getDistance(position, run[0]);
      const toEnd = getDistance(position, run[run.length - 1]);
      if (Math.min(toStart, toEnd) < bestDistance) {
        bestDistance = Math.min(toStart, toEnd);
        best = i;
        reversed = toEnd < toStart;
      }
    });
    const [taken] = runs.splice(best, 1);
    const run = reversed ? taken.reverse() : taken;
    if (bestDistance > 1e-6) {
      // The depth changes along the run: a ramp must not go below it.
      enter(
        run,
        false,
        top,
        z(run[0].d),
        depthAlong(
          run,
          run.map((p) => z(p.d)),
        ),
      );
    }
    for (const p of run.slice(1)) {
      builder.carveTo(p.x, p.y, z(p.d));
    }
    position = run[run.length - 1];
  }
  return position;
}

/**
 * The depth at each distance along a run, from its points' depths (straight
 * between them, as the bit moves).
 */
function depthAlong(points: CamPoint[], depths: number[]) {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(along[i - 1] + getDistance(points[i - 1], points[i]));
  }
  return (distance: number) => {
    const i = along.findIndex((a) => a >= distance);
    if (i <= 0) {
      return i === 0 ? depths[0] : depths[depths.length - 1];
    }
    const span = along[i] - along[i - 1];
    const t = span > 0 ? (distance - along[i - 1]) / span : 0;
    return depths[i - 1] + (depths[i] - depths[i - 1]) * t;
  };
}

/** Where the distance crosses `d` between two axis points. */
function crossing(a: AxisPoint, b: AxisPoint, d: number): AxisPoint {
  const t = b.d !== a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d };
}

type Component = {
  contours: CamPoint[][];
  inset: number;
  /** Inset of the level this one was offset from (where corner runs end). */
  fromInset: number;
};

/** The contours `inset` in, within the island `contours` (`fromInset` in). */
type Inside = (
  contours: CamPoint[][],
  fromInset: number,
  inset: number,
) => Promise<CamPoint[][]>;

type CornerOptions = {
  /** Corners with an interior angle up to this (radians) get sharpened. */
  maxAngle: number;
  depthAt: (inset: number) => number;
  maxInset: number;
  /** The original outline, used to make sure a corner run never gouges it. */
  boundary: CamPoint[][];
  /** How far outside `boundary` the insets count from (an inlay plug's). */
  shift: number;
};

async function findCollapse(
  contours: CamPoint[][],
  fromInset: number,
  step: number,
  inside: Inside,
) {
  let lo = 0;
  let hi = step;
  let found: CamPoint[][] | null = null;

  while (hi - lo > precision()) {
    const mid = (lo + hi) / 2;
    const inset = await inside(contours, fromInset, fromInset + mid);
    if (inset.length) {
      lo = mid;
      found = inset;
    } else {
      hi = mid;
    }
  }

  return found && lo > precision() ? { contours: found, inset: lo } : null;
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

function cutPath(
  builder: GCodeBuilder,
  points: CamPoint[],
  from: number,
  depth: number,
  enter: Enter,
) {
  enter(points, false, from, depth);
  for (let i = 1; i < points.length; i++) {
    builder.carveTo(points[i].x, points[i].y);
  }
}

/**
 * Cut one closed inset contour at the depth for `inset`. At each sharp convex
 * corner, run out along the bisector to where the previous level (`fromInset`)
 * had that corner, rising to its depth, and come back. The contour must have
 * the region on its left (see `groupComponents`). With `keep`, only the parts
 * of the contour where it holds are cut. Each cut starts with `enter`, from
 * `from`: how far down the material above it is already cleared.
 */
function cutContour(
  builder: GCodeBuilder,
  contour: CamPoint[],
  inset: number,
  fromInset: number,
  depthAt: (inset: number) => number,
  corners: CornerOptions | null,
  keep: ((p: CamPoint) => boolean) | null,
  enter: Enter,
  from: number,
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
  // The kept stretch from vertex `i` on (after `start`, where it comes back
  // in): what a ramp into it can go along.
  const stretch = (start: CamPoint | null, i: number) => {
    const points = start ? [start] : [];
    for (let k = 0; k < n && kept[(i + k) % n]; k++) {
      points.push(contour[(i + k) % n]);
    }
    return points;
  };
  const startAt = (start: CamPoint | null, i: number) => {
    if (kept.every(Boolean)) {
      enter(contour, true, from, depth);
    } else {
      enter(stretch(start, i), false, from, depth);
    }
  };
  // How far the edge from kept `a` towards dropped `b` stays kept.
  const lastKept = (a: CamPoint, b: CamPoint) => {
    const at = (t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * getDistance(a, b) > precision()) {
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
    startAt(null, 0);
  } else {
    startAt(lastKept(contour[0], contour[n - 1]), 0);
    builder.carveTo(contour[0].x, contour[0].y);
  }

  for (let i = 0; i < n; i++) {
    const vertex = contour[i];
    const next = contour[(i + 1) % n];
    const nextKept = kept[(i + 1) % n];

    if (!kept[i]) {
      // Resume where the edge to the next kept point comes back in.
      if (nextKept) {
        startAt(lastKept(next, vertex), (i + 1) % n);
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
  if (inset - fromInset <= precision()) {
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
  // (A plug's insets count from `shift` outside the outline: no runs where
  // they'd still be outside it.)
  const isValid = samples.every(
    (t) =>
      Math.abs(
        distanceToBoundary(at(t), corners.boundary) - (t - corners.shift),
      ) <=
        3 * precision() &&
      (t - corners.shift <= 3 * precision() ||
        insideRegion(at(t), corners.boundary)),
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
    if (getDistance(contour[i], candidate) >= 5 * precision()) {
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
