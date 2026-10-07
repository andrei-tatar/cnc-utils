import { InlayPlug, inlayPlugShape } from './inlay-plug';
import { combine, inflate } from './regions';
import {
  insetContours,
  carveRegion,
  holeSide,
  ShapePart,
  vCarveGeometry,
} from '../../cam/vcarve-geometry';
import {
  CamPoint,
  CamPoint3,
  CamPolygon,
  CamShape,
  CamVertex,
} from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { AxisPoint, medialAxis } from '../../cam/medial-axis';
import {
  curveTolerance,
  GeometrySettings,
  precision,
  useGeometry,
} from '../../cam/geometry';
import { getDistance } from '../../util';
import { nestPolygons } from '../../cam/polygon-nesting';
import {
  bulgeOf,
  distanceToPolygons,
  insideTester,
  pointAlong,
  polygonPoints,
  polygonsBounds,
  reversePolygon,
  segmentLength,
  signedArea,
  sweepOf,
  tangentAt,
} from '../../cam/arcs';
import { enterCut } from '../../cam/ramp';
import { travelOrder } from '../../cam/travel-order';
import { clearedAtMaxDepth, ClearingTool } from './route-vcarve-clearing';

/**
 * A closed contour of lines and arcs: each vertex's bulge shapes the segment
 * to the next (see `src/cam/arcs.ts`). Levels come from the geometry kernel
 * exact, so the passes follow arcs as arcs.
 */
type Loop = CamVertex[];

/**
 * Gets the bit down to `to` at the start of `path` (from safe height):
 * plunging, or ramping down from `from` (where the material starts).
 */
type Enter = (
  path: CamVertex[],
  close: boolean,
  from: number,
  to: number,
  floor?: (along: number) => number,
) => void;

/**
 * How far into what clearings left the flat bottom's passes still go, in
 * stepovers: an overlap that leaves no slivers between the two.
 */
const CLEARED_OVERLAP = 3;

/**
 * The longest move (mm) the bit makes at the bottom from one flat-bottom
 * cut to the next, instead of going up and back down.
 */
const LINK_DISTANCE = 5;

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
     * End mills that clear for this v-carve before it (see
     * routeVCarveClearing): the flat bottom then only needs what they left.
     */
    clearedBy?: ClearingTool[];
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
  const design = input;
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
          .filter((p) => !p.close && p.vertices.length > 1)
          .map((p) => p.vertices);
  const openPaths = optimizeTravel
    ? travelOrder(
        openPolylines.map((points) => {
          const ends = [points[0], points[points.length - 1]];
          return { starts: ends, end: (start: number) => ends[1 - start] };
        }),
        position,
      ).map(({ index, start }) =>
        start
          ? reversePolygon({ vertices: openPolylines[index], close: false })
              .vertices
          : openPolylines[index],
      )
    : openPolylines;

  for (const points of openPaths) {
    cutPath(builder, points, top, depthAt(maxInset), enter);
    position = points[points.length - 1];
  }

  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.vertices.length > 1);

  if (!closed.length || maxDepth <= 0) {
    return builder;
  }

  const region = await carveRegion(closed, options.mode);
  // Insets below are from the outline of `area`: the region, or the region
  // grown by `shift` for a plug.
  const area = shift > 0 ? await inflate(region, shift) : region;
  // Each level `inset` in, offset from the region itself (grown by what's
  // left of `shift`, for a plug): exact, and it keeps the corners sharp
  // where a plug's area wraps round the design.
  const levels = new Map<number, Promise<Loop[]>>();
  const levelAt = (inset: number) => {
    let level = levels.get(inset);
    if (!level) {
      level = insetContours(region, inset - shift).then(loopsOf);
      levels.set(inset, level);
    }
    return level;
  };
  // The contours `inset` in, within the island `contours` (`fromInset` in):
  // the parts of that level near it, clipped to it.
  const inside: Inside = async (contours, _fromInset, inset) => {
    const box = bounds(contours);
    const near = (await levelAt(inset)).filter((c) =>
      overlaps(bounds([c]), box),
    );
    return near.length
      ? loopsOf(
          await combine(polygonsOf(near), polygonsOf(contours), 'intersection'),
        )
      : [];
  };
  // Within a step of the island (where it collapses): offsetting it.
  const withinStep: Inside = async (contours, fromInset, inset) =>
    fromInset < shift
      ? inside(contours, fromInset, inset)
      : loopsOf(await insetContours(polygonsOf(contours), inset - fromInset));

  // "Holes only" makes the same cuts as "outlines minus holes" but keeps just
  // the parts growing out from the holes.
  const keepAt: (inset: number) => ((p: CamPoint) => boolean) | null =
    options.mode === 'holes' ? await holeSide(closed) : () => null;

  if (!(options.stepover && options.stepover > 0)) {
    await carveSinglePass(
      builder,
      region,
      shift,
      () => inside(loopsOf(area), 0, maxInset),
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
        insideBoundary: insideTester(region),
        shift,
      }
    : null;

  // The flat bottom's passes (past the max-depth inset) are only needed
  // where the clearings didn't reach, overlapping them a little.
  const cleared =
    options.clearFlatBottom && options.clearedBy?.length
      ? await insetContours(
          await clearedAtMaxDepth(design, options, options.clearedBy),
          CLEARED_OVERLAP * stepover,
        )
      : [];
  const inCleared = cleared.length ? insideTester(cleared) : null;
  const uncut = inCleared ? (p: CamPoint) => !inCleared(p) : null;
  const flatBottom = (inset: number) =>
    !!uncut && inset > maxInset + precision();
  // A long edge can cross what's cleared between its ends: give the
  // flat bottom's contours a point either side of every crossing, so
  // their points tell what to cut.
  const crossings = (inset: number, contours: Loop[]) =>
    flatBottom(inset)
      ? contours.map((c) => splitWhereChanges(c, uncut!, stepover / 2))
      : contours;
  const keepCut = (inset: number) => {
    const keep = keepAt(inset);
    if (!flatBottom(inset)) {
      return keep;
    }
    return keep ? (p: CamPoint) => keep(p) && uncut!(p) : uncut;
  };

  // Step size that lands exactly on the max-depth inset, so the walls reach
  // full depth before any flat-bottom clearing starts.
  const stepFrom = (inset: number) =>
    inset < maxInset - precision()
      ? Math.min(stepover, maxInset - inset)
      : stepover;

  // Those passes come in many short pieces (round the corners the end mill
  // can't reach, where they graze its edge): kept for the end, to cut
  // nearest first, going from one to the next at the bottom.
  const pieces: Piece[] = [];
  const later = recorder(pieces);
  const cutWith = (inset: number) =>
    flatBottom(inset) ? later : { carver: builder, enter };
  // Where it's below the cone, the material left after the walls are cut
  // (pieces aren't cut in order, level after level).
  const fromAt = (inset: number, fromInset: number) =>
    clearedAbove(inset, flatBottom(inset) ? maxInset : fromInset);

  const firstInset = tipRadius + stepFrom(tipRadius);
  const firstLevel = groupComponents(
    await inside(loopsOf(area), 0, firstInset),
  );

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
    const toCut = crossings(inset, contours);
    // All cleared: so is everything further in.
    if (flatBottom(inset) && !toCut.some((c) => c.some(uncut!))) {
      continue;
    }

    for (const contour of orderByProximity(toCut, position)) {
      cutContour(
        cutWith(inset).carver,
        contour,
        inset,
        fromInset,
        depthAt,
        corners,
        keepCut(inset),
        cutWith(inset).enter,
        fromAt(inset, fromInset),
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
    const collapse = await findCollapse(contours, inset, step, withinStep);
    if (collapse) {
      const collapsed = crossings(
        inset + collapse.inset,
        groupComponents(collapse.contours).flat(),
      );
      for (const contour of orderByProximity(collapsed, position)) {
        cutContour(
          cutWith(inset + collapse.inset).carver,
          contour,
          inset + collapse.inset,
          inset,
          depthAt,
          corners,
          keepCut(inset + collapse.inset),
          cutWith(inset + collapse.inset).enter,
          fromAt(inset + collapse.inset, inset),
        );
        position = contour[0];
      }
    }
  }

  if (pieces.length) {
    // Anywhere the bit's centre is at least the max-depth inset in, it's
    // clear of the walls at the bottom. "Holes only" leaves the outlines'
    // flat bottom alone: no moves across it.
    const bottom = polygonsOf(
      await inside(loopsOf(area), 0, maxInset - 2 * precision()),
    );
    const inBottom = insideTester(bottom);
    const link = (a: CamPoint, b: CamPoint) =>
      options.mode !== 'holes' &&
      getDistance(a, b) <= LINK_DISTANCE &&
      segmentInside(a, b, inBottom);
    position = cutPieces(builder, pieces, enter, link, position);
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
  region: CamPolygon[],
  shift: number,
  /** The contours at the max depth. */
  deepest: () => Promise<Loop[]>,
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
  region: CamPolygon[],
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
  // (On the outline's points, arcs within the curve tolerance.)
  for (const regionAxis of medialAxis(
    region.map((p) => polygonPoints(p, curveTolerance())),
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
        run.map(({ x, y }) => ({ x, y })),
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

/** Where cuts go: a GCodeBuilder, or a recorder of pieces. */
type Carver = {
  carveTo(x: number, y: number, z?: number): unknown;
  arcTo(x: number, y: number, bulge: number, z?: number): unknown;
};

/** A point of a recorded cut, and the arc (if any) arriving there. */
type PiecePoint = CamPoint3 & { arc?: number };

/** A cut kept for later: how it was entered, and where it goes. */
type Piece = {
  close: boolean;
  /** How far down the material above it is cleared. */
  from: number;
  points: PiecePoint[];
};

/** Records cuts as pieces instead of making them. */
function recorder(pieces: Piece[]): { carver: Carver; enter: Enter } {
  const add = (x: number, y: number, z: number | undefined, arc: number) => {
    const points = pieces[pieces.length - 1].points;
    const point: PiecePoint = { x, y, z: z ?? points[points.length - 1].z };
    if (arc) point.arc = arc;
    points.push(point);
  };
  return {
    carver: {
      carveTo: (x, y, z) => add(x, y, z, 0),
      arcTo: (x, y, bulge, z) => add(x, y, z, bulge),
    },
    enter(path, close, from, to) {
      pieces.push({
        close,
        from,
        points: [{ x: path[0].x, y: path[0].y, z: to }],
      });
    },
  };
}

/**
 * Cut the pieces nearest first (open ones either way round, loops from
 * their nearest point), moving straight from one to the next at the same
 * depth where `link` allows, instead of going up and back down. Returns
 * where it ends.
 */
function cutPieces(
  builder: GCodeBuilder,
  pieces: Piece[],
  enter: Enter,
  link: (a: CamPoint, b: CamPoint) => boolean,
  position: CamPoint,
): CamPoint {
  const remaining = [...pieces];
  let at: CamPoint3 | null = null;
  while (remaining.length) {
    let best = { piece: 0, start: 0, distance: Infinity };
    remaining.forEach((piece, i) => {
      const { points } = piece;
      const starts = piece.close
        ? points.map((_, k) => k)
        : [0, points.length - 1];
      for (const k of starts) {
        const distance = getDistance(at ?? position, points[k]);
        if (distance < best.distance) {
          best = { piece: i, start: k, distance };
        }
      }
    });
    const [piece] = remaining.splice(best.piece, 1);
    const points = startingFrom(piece, best.start);
    const start = points[0];
    if (at && Math.abs(at.z - start.z) < 1e-6 && link(at, start)) {
      builder.carveTo(start.x, start.y, start.z);
    } else {
      // The path to ramp along: each vertex's bulge is the arc on from it.
      const path = points.map((p, i) => {
        const arc = points[i + 1]?.arc;
        return arc ? { x: p.x, y: p.y, bulge: arc } : { x: p.x, y: p.y };
      });
      enter(path, piece.close, piece.from, start.z);
    }
    for (const p of points.slice(1)) {
      if (p.arc) {
        builder.arcTo(p.x, p.y, p.arc, p.z);
      } else {
        builder.carveTo(p.x, p.y, p.z);
      }
    }
    at = points[points.length - 1];
  }
  return at ?? position;
}

/**
 * The piece's points from point `k` on: an open piece reversed when that's
 * its end (each arc then arriving the other way), a loop going once round
 * back to it.
 */
function startingFrom(piece: Piece, k: number): PiecePoint[] {
  const { points } = piece;
  if (!piece.close) {
    if (k === 0) return points;
    const m = points.length - 1;
    return points.map((_, i) => {
      const p = points[m - i];
      const arc = i > 0 ? -(points[m - i + 1].arc ?? 0) : 0;
      const point: PiecePoint = { x: p.x, y: p.y, z: p.z };
      if (arc) point.arc = arc;
      return point;
    });
  }
  const first = points[0];
  const last = points[points.length - 1];
  const closesItself =
    points.length > 1 && getDistance(first, last) < 1e-9 && first.z === last.z;
  // The first point takes the arc that arrives back at it.
  const loop = closesItself
    ? [{ ...first, arc: last.arc }, ...points.slice(1, -1)]
    : points;
  const rotated = [
    ...loop.slice(k % loop.length),
    ...loop.slice(0, k % loop.length),
  ];
  return [...rotated, rotated[0]];
}

/** Whether the segment from `a` to `b` stays inside a region. */
function segmentInside(
  a: CamPoint,
  b: CamPoint,
  inside: (p: CamPoint) => boolean,
) {
  const samples = Math.max(1, Math.ceil(getDistance(a, b) / 0.05));
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (!inside(p)) {
      return false;
    }
  }
  return true;
}

type Component = {
  contours: Loop[];
  inset: number;
  /** Inset of the level this one was offset from (where corner runs end). */
  fromInset: number;
};

/** The contours `inset` in, within the island `contours` (`fromInset` in). */
type Inside = (
  contours: Loop[],
  fromInset: number,
  inset: number,
) => Promise<Loop[]>;

type CornerOptions = {
  /** Corners with an interior angle up to this (radians) get sharpened. */
  maxAngle: number;
  depthAt: (inset: number) => number;
  maxInset: number;
  /** The original outline, used to make sure a corner run never gouges it. */
  boundary: CamPolygon[];
  /** Whether a point is inside `boundary`. */
  insideBoundary: (p: CamPoint) => boolean;
  /** How far outside `boundary` the insets count from (an inlay plug's). */
  shift: number;
};

async function findCollapse(
  contours: Loop[],
  fromInset: number,
  step: number,
  inside: Inside,
) {
  let lo = 0;
  let hi = step;
  let found: Loop[] | null = null;

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
function groupComponents(contours: Loop[]): Loop[][] {
  // Orient every contour so the material to remove lies on its left:
  // outlines counter-clockwise, holes clockwise.
  const orient = (polygon: CamPolygon, counterClockwise: boolean) =>
    (signedArea(polygon) > 0 === counterClockwise
      ? polygon
      : reversePolygon(polygon)
    ).vertices;

  return nestPolygons(polygonsOf(contours)).map(({ outer, holes }) => [
    orient(outer, true),
    ...holes.map((hole) => orient(hole, false)),
  ]);
}

function orderComponents(components: Loop[][], start: CamPoint) {
  const remaining = [...components];
  const ordered: Loop[][] = [];
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
function orderByProximity(contours: Loop[], start: CamPoint) {
  const remaining = [...contours];
  const ordered: Loop[] = [];
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
  points: CamVertex[],
  from: number,
  depth: number,
  enter: Enter,
) {
  enter(points, false, from, depth);
  for (let i = 1; i < points.length; i++) {
    builder.arcTo(points[i].x, points[i].y, bulgeOf(points[i - 1]));
  }
}

/**
 * Cut one closed inset contour at the depth for `inset`. At each sharp convex
 * corner, run out along the bisector to where the previous level (`fromInset`)
 * had that corner, rising to its depth, and come back. The contour must have
 * the region on its left (see `groupComponents`). With `keep`, only the parts
 * of the contour where it holds are cut (tested at the vertices; an edge is
 * cut where it changes, an arc into a shorter arc). Each cut starts with
 * `enter`, from `from`: how far down the material above it is cleared.
 */
function cutContour(
  builder: Carver,
  contour: Loop,
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
  const segment = (i: number) => {
    const a = contour[i];
    const b = contour[(i + 1) % n];
    return { a, b, bulge: bulgeOf(a) };
  };
  // The vertex starting the part of segment i from t0 to t1.
  const part = (i: number, t0: number, t1: number): CamVertex => {
    const { a, b, bulge } = segment(i);
    const p = pointAlong(a, b, bulge, t0);
    const partial = partBulge(bulge, t0, t1);
    return partial ? { ...p, bulge: partial } : p;
  };
  // The kept stretch from vertex `i` on (after `start`, where it comes back
  // in): what a ramp into it can go along.
  const stretch = (start: CamVertex | null, i: number) => {
    const points: CamVertex[] = start ? [start] : [];
    for (let k = 0; k < n && kept[(i + k) % n]; k++) {
      points.push(contour[(i + k) % n]);
    }
    return points;
  };
  const startAt = (start: CamVertex | null, i: number) => {
    if (kept.every(Boolean)) {
      enter(contour, true, from, depth);
    } else {
      enter(stretch(start, i), false, from, depth);
    }
  };
  // How far (0 to 1) along segment i it stays kept: from its start, or
  // (`fromEnd`) back from its end.
  const lastKept = (i: number, fromEnd: boolean) => {
    const { a, b, bulge } = segment(i);
    const length = segmentLength(a, b, bulge);
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * length > precision()) {
      const mid = (lo + hi) / 2;
      if (keep!(pointAlong(a, b, bulge, fromEnd ? 1 - mid : mid))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return fromEnd ? 1 - lo : lo;
  };
  const arcTo = (to: CamPoint, bulge: number, z?: number) =>
    bulge
      ? builder.arcTo(to.x, to.y, bulge, z)
      : builder.carveTo(to.x, to.y, z);

  if (kept[n - 1]) {
    startAt(null, 0);
  } else {
    const t = lastKept(n - 1, true);
    const start = part(n - 1, t, 1);
    startAt(start, 0);
    arcTo(contour[0], bulgeOf(start));
  }

  for (let i = 0; i < n; i++) {
    const vertex = contour[i];
    const next = contour[(i + 1) % n];
    const nextKept = kept[(i + 1) % n];

    if (!kept[i]) {
      // Resume where the edge to the next kept point comes back in.
      if (nextKept) {
        const t = lastKept(i, true);
        const start = part(i, t, 1);
        startAt(start, (i + 1) % n);
        arcTo(next, bulgeOf(start));
      }
      continue;
    }

    const run = corners
      ? cornerRun(
          direction(contour, i, -1),
          vertex,
          direction(contour, i, 1),
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

    if (nextKept) {
      arcTo(next, bulgeOf(vertex));
    } else {
      const t = lastKept(i, false);
      arcTo(
        pointAlong(vertex, next, bulgeOf(vertex), t),
        partBulge(bulgeOf(vertex), 0, t),
      );
    }
  }
}

/** Bulge of the part of a segment from t0 to t1 (0 to 1 along it). */
function partBulge(bulge: number, t0: number, t1: number): number {
  return bulge ? Math.tan(((t1 - t0) * sweepOf(bulge)) / 4) : 0;
}

/**
 * The closed contour with vertices added where `test` changes along its
 * segments (sampled every `spacing`): one on each side of the change,
 * `precision()` apart, arcs cut into shorter arcs.
 */
function splitWhereChanges(
  contour: Loop,
  test: (p: CamPoint) => boolean,
  spacing: number,
): Loop {
  const result: Loop = [];
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % n];
    const bulge = bulgeOf(a);
    const length = segmentLength(a, b, bulge);
    const at = (t: number) => pointAlong(a, b, bulge, t);
    const samples = Math.ceil(length / Math.max(precision(), spacing));
    // Where along the segment to cut it.
    const cuts: number[] = [];
    let lastT = 0;
    let last = test(a);
    for (let k = 1; k <= samples; k++) {
      const t = k / samples;
      const value = test(at(t));
      if (value !== last) {
        let lo = lastT;
        let hi = t;
        while ((hi - lo) * length > precision()) {
          const mid = (lo + hi) / 2;
          if (test(at(mid)) === last) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        if (lo > 0) cuts.push(lo);
        if (hi < 1) cuts.push(hi);
      }
      lastT = t;
      last = value;
    }
    const ts = [0, ...cuts, 1];
    for (let k = 0; k < ts.length - 1; k++) {
      const p = k ? at(ts[k]) : { x: a.x, y: a.y };
      const partial = partBulge(bulge, ts[k], ts[k + 1]);
      result.push(partial ? { ...p, bulge: partial } : p);
    }
  }
  return result;
}

/**
 * Points (outward from the vertex) tracing a sharp corner's bisector from
 * `inset` back to `fromInset`, at the depth that keeps the cone touching both
 * edges. Null when the corner isn't sharp or the run would cut the outline.
 */
function cornerRun(
  /** Unit direction from the vertex back along the edge before it. */
  a: CamPoint,
  vertex: CamPoint,
  /** Unit direction from the vertex along the edge after it. */
  b: CamPoint,
  inset: number,
  fromInset: number,
  corners: CornerOptions,
): CamPoint3[] | null {
  if (inset - fromInset <= precision()) {
    return null;
  }

  // Region on the left: a left turn is a convex corner of the region.
  const turn = -a.x * b.y + a.y * b.x;
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
        distanceToPolygons(at(t), corners.boundary) - (t - corners.shift),
      ) <=
        3 * precision() &&
      (t - corners.shift <= 3 * precision() || corners.insideBoundary(at(t))),
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
 * Unit direction from vertex i along its edges: back along the one before it
 * (`side` -1), or on along the one after (1) — their tangents at the vertex.
 * Past segments a few precision steps short (or less), towards the first
 * vertex that far: tiny segments don't fake (or hide) a sharp corner.
 */
function direction(contour: Loop, i: number, side: 1 | -1): CamPoint {
  const n = contour.length;
  const vertex = contour[i];
  const j = (i + side + n) % n;
  const [a, b] = side === 1 ? [vertex, contour[j]] : [contour[j], vertex];
  const bulge = bulgeOf(a);
  if (segmentLength(a, b, bulge) >= 5 * precision()) {
    const t = tangentAt(a, b, bulge, side === 1 ? 0 : 1);
    return side === 1 ? t : { x: -t.x, y: -t.y };
  }
  for (let k = 2; k < n; k++) {
    const candidate = contour[(i + side * k + n * k) % n];
    const d = getDistance(vertex, candidate);
    if (d >= 5 * precision()) {
      return {
        x: (candidate.x - vertex.x) / d,
        y: (candidate.y - vertex.y) / d,
      };
    }
  }
  const d = getDistance(vertex, contour[j]) || 1;
  return { x: (contour[j].x - vertex.x) / d, y: (contour[j].y - vertex.y) / d };
}

function unit(x: number, y: number): CamPoint | null {
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / length, y: y / length } : null;
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function bounds(contours: Loop[]): Bounds {
  return polygonsBounds(polygonsOf(contours));
}

function overlaps(a: Bounds, b: Bounds) {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
  );
}

function loopsOf(polygons: CamPolygon[]): Loop[] {
  return polygons.map((p) => p.vertices);
}

function polygonsOf(loops: Loop[]): CamPolygon[] {
  return loops.map((vertices) => ({ vertices, close: true }));
}
