import { CamPoint, CamPolygon, CamShape, CamVertex } from '../../cam/types';
import { getDistance } from '../../util';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  curveTolerance,
  GeometrySettings,
  precision,
  useGeometry,
} from '../../cam/geometry';
import { getCentroid } from './utils';
import { orderPoints } from '../../cam/travel-order';
import { enterCut } from '../../cam/ramp';
import { rasterLines, rasterPaths, staysInside } from '../../cam/raster';
import { booleanOperation, inflatePaths, offsetRegion } from '../../cam/kernel';
import {
  bulgeOf,
  polygonPoints,
  polygonsBounds,
  signedArea,
  windingNumber,
} from '../../cam/arcs';

export async function routePocketHole(
  input: CamShape[],
  options: {
    toolSize: number;
    toolEngagement: number;
    leaveStock: number;
    depthPerStep: number;
    steps: number;
    startDepth: number;
    /**
     * offset: rings following the outline, inwards.
     * raster: parallel lines `alongAxis`, then a pass round the outline.
     */
    strategy?: 'offset' | 'raster';
    alongAxis?: 'x' | 'y';
    /** Raster: cut every line of the last level the same way. */
    allPassesInSameDirection?: boolean;
    /** Ramp down into the cut at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
    /** How precisely to work (see GeometrySettings). */
    geometry?: GeometrySettings;
    /** Pocket the separate areas in the order that keeps travel short. */
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  let start: CamPoint = { x: 0, y: 0 };

  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const groups = await groupShapes(input);
  const sorted =
    options.optimizeTravel === false ? groups : sortGroups(groups, start);

  if (options.strategy === 'raster') {
    for (const shape of sorted) {
      start = await routeRaster(builder, shape, { ...options, start });
    }
    return builder;
  }

  for (const shape of sorted) {
    const outlines = await getShapeOutlines(shape, options);
    // When ramping: where each loop's last ramp ended, so the next level's
    // ramp carries on from there (the same loops are cut at every level).
    const rampEnds = new Map<number, CamPoint>();

    for (let step = 0; step < options.steps; step++) {
      builder.goToSafeHeight();
      const depth = options.startDepth + options.depthPerStep * (step + 1);

      let lastOutline: CamPolygon | null = null;
      for (const [index, outline] of outlines.entries()) {
        const overlapsLastOutline = lastOutline
          ? overlaps(outline, lastOutline)
          : false;
        lastOutline = outline;

        let loop = startingNearest(outline.vertices, start);

        if (
          !overlapsLastOutline ||
          getDistance(start, loop[0]) > options.toolSize * 2
        ) {
          builder.goToSafeHeight();
        }

        const entering = builder.isAtSafetyHeight;
        if (entering) {
          // Ramp along this loop, from the level above.
          const rampEnd = rampEnds.get(index);
          loop = enterCut(
            builder,
            loop,
            true,
            -(depth - options.depthPerStep),
            -depth,
            options.rampAngle ?? null,
            options.toolSize,
            Infinity,
            rampEnd && { point: rampEnd, down: false },
          );
          if (options.rampAngle) {
            rampEnds.set(index, loop[0]);
          }
        } else {
          // Still down: across to this loop.
          builder.carveTo(loop[0].x, loop[0].y);
        }
        start = carveLoop(builder, loop);
      }
    }
  }

  return builder;
}

/**
 * Round a closed loop from its first vertex and back to it (the bit is
 * there already), arcs as arcs. Returns where it ends.
 */
function carveLoop(builder: GCodeBuilder, loop: CamVertex[]): CamPoint {
  for (let i = 1; i < loop.length; i++) {
    builder.arcTo(loop[i].x, loop[i].y, bulgeOf(loop[i - 1]));
  }
  if (loop.length > 1) {
    builder.arcTo(loop[0].x, loop[0].y, bulgeOf(loop[loop.length - 1]));
  }
  return loop[0];
}

/** The closed loop starting at its vertex nearest `point`. */
function startingNearest(loop: CamVertex[], point: CamPoint): CamVertex[] {
  let best = 0;
  let bestDistance = Infinity;
  loop.forEach((v, i) => {
    const d = getDistance(point, v);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return [...loop.slice(best), ...loop.slice(0, best)];
}

/** Cut one group of shapes as raster lines; returns where the bit ends up. */
async function routeRaster(
  builder: GCodeBuilder,
  shape: CamPolygon[],
  options: {
    toolSize: number;
    toolEngagement: number;
    leaveStock: number;
    depthPerStep: number;
    steps: number;
    startDepth: number;
    alongAxis?: 'x' | 'y';
    allPassesInSameDirection?: boolean;
    rampAngle?: number | null;
    start: CamPoint;
  },
): Promise<CamPoint> {
  let start = options.start;
  const area = await toolCenterArea(shape, options);
  if (!area.length) {
    return start;
  }
  // The lines are worked out on the outline's points (arcs within the
  // curve tolerance); the pass round the outline follows its arcs.
  const loops = area.map((p) => polygonPoints(p, curveTolerance()));

  const along = options.alongAxis ?? 'y';
  const lines = rasterLines(
    loops,
    along,
    options.toolSize * options.toolEngagement,
  );

  for (let step = 0; step < options.steps; step++) {
    const depth = options.startDepth + options.depthPerStep * (step + 1);
    const oneWay =
      !!options.allPassesInSameDirection && step === options.steps - 1;

    // Carry on to the next path without lifting when it's close and the
    // move stays inside (one way always lifts, like the flat operation).
    const goTo = (point: CamPoint) => {
      if (
        oneWay ||
        builder.isAtSafetyHeight ||
        getDistance(start, point) > options.toolSize * 2 ||
        !staysInside(loops, start, point)
      ) {
        builder.goToSafeHeight();
      }
    };
    const cut = (path: CamVertex[], close: boolean) => {
      goTo(path[0]);
      if (builder.isAtSafetyHeight) {
        path = enterCut(
          builder,
          path,
          close,
          -(depth - options.depthPerStep),
          -depth,
          options.rampAngle ?? null,
          options.toolSize,
        );
      } else {
        builder.carveTo(path[0].x, path[0].y);
      }
      if (close) {
        start = carveLoop(builder, path);
        return;
      }
      for (let i = 1; i < path.length; i++) {
        builder.arcTo(path[i].x, path[i].y, bulgeOf(path[i - 1]));
      }
      start = path[path.length - 1];
    };

    builder.goToSafeHeight();
    for (const path of rasterPaths(lines, loops, along, start, oneWay)) {
      cut(path, false);
    }

    // Round the outline (and any islands), nearest first, to clean up
    // between the ends of the lines.
    const left = area.map((p) => p.vertices);
    while (left.length) {
      let best = { loop: 0, distance: Infinity };
      left.forEach((loop, i) => {
        const nearest = startingNearest(loop, start)[0];
        const distance = getDistance(start, nearest);
        if (distance < best.distance) {
          best = { loop: i, distance };
        }
      });
      const [loop] = left.splice(best.loop, 1);
      cut(startingNearest(loop, start), true);
    }
  }

  return start;
}

/**
 * Where the centre of the tool can go: the shapes as one region, less the
 * stock to leave and half the tool. Exact: arcs stay arcs. Outlines are read
 * as offsets read them (see `inflatePaths`: overlapping ones merge), and
 * ones a hair apart are joined first (grown and shrunk back by twice the
 * precision).
 */
async function toolCenterArea(
  polygons: CamPolygon[],
  options: { leaveStock: number; toolSize: number },
): Promise<CamPolygon[]> {
  const join = 2 * precision();
  const region = await inflatePaths(polygons, join, 'round', 'polygon');
  return offsetRegion(
    region,
    -(join + options.leaveStock + options.toolSize / 2),
  );
}

/**
 * The loops to cut, innermost first: the tool-centre area and successive
 * insets of it, a stepover apart. Each inset is taken from the area itself
 * (exact, no rounding builds up), and goes in before the first loop it
 * lies within (or around), so the bit works outwards and stays down from
 * one loop to the next.
 */
async function getShapeOutlines(
  polygons: CamPolygon[],
  options: {
    leaveStock: number;
    toolSize: number;
    toolEngagement: number;
  },
): Promise<CamPolygon[]> {
  const area = await toolCenterArea(polygons, options);
  const outlines: CamPolygon[] = [...area];
  const step = options.toolSize * options.toolEngagement;
  if (!(step > 0)) {
    return outlines;
  }
  for (let k = 1; ; k++) {
    const level = await offsetRegion(area, -step * k);
    if (!level.length) {
      break;
    }
    const batch = [...level].sort(
      (a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)),
    );
    for (const loop of batch) {
      const at = outlines.findIndex((o) => overlaps(loop, o));
      if (at >= 0) {
        outlines.splice(at, 0, loop);
      }
    }
  }
  return outlines;
}

/**
 * Whether two loops that don't cross overlap as filled areas: one lies in
 * the other.
 */
function overlaps(a: CamPolygon, b: CamPolygon): boolean {
  const ba = polygonsBounds([a]);
  const bb = polygonsBounds([b]);
  if (
    ba.minX > bb.maxX ||
    bb.minX > ba.maxX ||
    ba.minY > bb.maxY ||
    bb.minY > ba.maxY
  ) {
    return false;
  }
  const inside = (p: CamPoint, loop: CamPolygon) =>
    windingNumber(p, [{ ...loop, close: true }]) !== 0;
  return inside(a.vertices[0], b) || inside(b.vertices[0], a);
}

/**
 * Group polygons so that overlapping ones are processed together.
 * This is to optimize travel and go depth first.
 */
async function groupShapes(input: CamShape[]): Promise<CamPolygon[][]> {
  const polygons = input
    .flatMap((p) => p.polygons)
    .filter((p) => p.vertices.length > 1)
    .map((p) => ({ ...p, close: true }));
  const groups: CamPolygon[][] = [];
  for (const polygon of polygons) {
    let found = false;
    for (const group of groups) {
      if (await overlapsAny(polygon, group)) {
        group.push(polygon);
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push([polygon]);
    }
  }
  return groups;
}

/** Whether the polygon's area overlaps any of the group's (non-zero). */
async function overlapsAny(polygon: CamPolygon, group: CamPolygon[]) {
  const box = polygonsBounds([polygon]);
  const near = group.filter((g) => {
    const b = polygonsBounds([g]);
    return !(
      box.minX > b.maxX ||
      b.minX > box.maxX ||
      box.minY > b.maxY ||
      b.minY > box.maxY
    );
  });
  if (!near.length) {
    return false;
  }
  return (
    (await booleanOperation([polygon], near, 'intersection', 'non-zero'))
      .length > 0
  );
}

function sortGroups(
  input: CamPolygon[][],
  start: CamPoint = { x: 0, y: 0 },
): CamPolygon[][] {
  if (input.length <= 1) {
    return input;
  }
  const centers = new Map<CamPolygon[], CamPoint>(
    input.map((group) => {
      const centroids = group.map((p) =>
        getCentroid(p.vertices.map(({ x, y }) => ({ x, y }))),
      );
      const cx = centroids.reduce((s, a) => s + a.x, 0) / centroids.length;
      const cy = centroids.reduce((s, a) => s + a.y, 0) / centroids.length;
      return [group, { x: cx, y: cy }];
    }),
  );
  return orderPoints(
    input.map((group) => ({ ...centers.get(group)!, group })),
    start,
  ).map(({ group }) => group);
}
