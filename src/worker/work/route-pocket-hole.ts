import { PathD, PathsD } from 'clipper2-wasm/dist/clipper2z';
import {
  clipperInflateRaw,
  getAreaResolver,
  makePaths,
  makePathsFromPath,
  pathsIntersect,
  pathIntersectsAnyFromGroup,
  simplifyPath,
} from '../../cam/clipper';
import { CamShape, CamPoint } from '../../cam/types';
import { getDistance, pointsEqual } from '../../util';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  decimals,
  GeometrySettings,
  precision,
  useGeometry,
} from '../../cam/geometry';
import { getCentroid } from './utils';
import { orderPoints } from '../../cam/travel-order';
import { enterCut } from '../../cam/ramp';
import { rasterLines, rasterPaths, staysInside } from '../../cam/raster';

// Irrelevant with round joins.
const MITER_LIMIT = 2;
const ARC_TOLERANCE = 0;
const offsetArgs = () =>
  ['round', 'polygon', MITER_LIMIT, decimals(), ARC_TOLERANCE] as const;

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
    options.optimizeTravel === false ? groups : sortPaths(groups, start);

  if (options.strategy === 'raster') {
    for (const shape of sorted) {
      start = await routeRaster(builder, shape, { ...options, start });
    }
    sorted.forEach((s) => s.delete());
    return builder;
  }

  for (const shape of sorted) {
    const outlines = await getShapeOutlines(shape, { ...options, start });
    // When ramping: where each loop's last ramp ended, so the next level's
    // ramp carries on from there (the same loops are cut at every level).
    const rampEnds = new Map<number, CamPoint>();

    for (let step = 0; step < options.steps; step++) {
      builder.goToSafeHeight();
      const depth = options.startDepth + options.depthPerStep * (step + 1);

      let lastOutline: PathD | null = null;
      for (const [index, outline] of outlines.entries()) {
        const intersectsLastOutline = lastOutline
          ? await pathsIntersect(outline, lastOutline, decimals())
          : false;

        lastOutline = outline;

        let outlinePoints = getPoints(outline);
        const closestPointIndex = findClosestPointIndex(start, outlinePoints);
        const removed = outlinePoints.splice(0, closestPointIndex);
        outlinePoints.push(...removed);

        let firstPoint: CamPoint | null = null,
          lastPoint: CamPoint | null = null;

        if (
          !intersectsLastOutline ||
          getDistance(start, outlinePoints[0]) > options.toolSize * 2
        ) {
          builder.goToSafeHeight();
        }

        const entering = builder.isAtSafetyHeight;
        if (entering) {
          // Ramp along this loop, from the level above.
          const rampEnd = rampEnds.get(index);
          outlinePoints = enterCut(
            builder,
            outlinePoints,
            true,
            -(depth - options.depthPerStep),
            -depth,
            options.rampAngle ?? null,
            options.toolSize,
            Infinity,
            rampEnd && { point: rampEnd, down: false },
          );
          if (options.rampAngle) {
            rampEnds.set(index, outlinePoints[0]);
          }
        }

        for (let i = 0; i < outlinePoints.length; i++) {
          const pt = outlinePoints[i];

          if (i === 0) {
            firstPoint = pt;
          }
          if (i === outlinePoints.length - 1) {
            lastPoint = pt;
          }

          // (Entering left the bit at the first point.)
          if (i > 0 || !entering) {
            builder.carveTo(pt.x, pt.y);
          }
        }

        if (firstPoint && lastPoint && !pointsEqual(firstPoint, lastPoint)) {
          builder.carveTo(firstPoint.x, firstPoint.y);
          start = firstPoint;
        } else if (lastPoint) {
          start = lastPoint;
        }
      }
    }

    outlines.forEach((o) => o.delete());
  }

  sorted.forEach((s) => s.delete());

  return builder;
}

/** Cut one group of shapes as raster lines; returns where the bit ends up. */
async function routeRaster(
  builder: GCodeBuilder,
  shape: PathsD,
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
  const loops: CamPoint[][] = [];
  for (let i = 0; i < area.size(); i++) {
    const path = area.get(i);
    loops.push(getPoints(path));
    path.delete();
  }
  area.delete();
  if (!loops.length) {
    return start;
  }

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
    const cut = (points: CamPoint[], close: boolean) => {
      goTo(points[0]);
      if (builder.isAtSafetyHeight) {
        points = enterCut(
          builder,
          points,
          close,
          -(depth - options.depthPerStep),
          -depth,
          options.rampAngle ?? null,
          options.toolSize,
        );
      } else {
        builder.carveTo(points[0].x, points[0].y);
      }
      for (const pt of points.slice(1)) {
        builder.carveTo(pt.x, pt.y);
      }
      if (close) {
        builder.carveTo(points[0].x, points[0].y);
      }
      start = close ? points[0] : points[points.length - 1];
    };

    builder.goToSafeHeight();
    for (const path of rasterPaths(lines, loops, along, start, oneWay)) {
      cut(path, false);
    }

    // Round the outline (and any islands), nearest first, to clean up
    // between the ends of the lines.
    const left = [...loops];
    while (left.length) {
      let best = { loop: 0, point: 0, distance: Infinity };
      left.forEach((loop, i) => {
        const point = findClosestPointIndex(start, loop);
        const distance = getDistance(start, loop[point]);
        if (distance < best.distance) {
          best = { loop: i, point, distance };
        }
      });
      const [loop] = left.splice(best.loop, 1);
      cut([...loop.slice(best.point), ...loop.slice(0, best.point)], true);
    }
  }

  return start;
}

/**
 * Where the centre of the tool can go: the shapes joined, less the stock to
 * leave and half the tool.
 */
async function toolCenterArea(
  paths: PathsD,
  options: { leaveStock: number; toolSize: number },
): Promise<PathsD> {
  //small grow to join any overlapping polygons
  paths = await clipperInflateRaw(paths, precision() * 2, ...offsetArgs());

  //shrink to leave stock and half tool size
  paths = await clipperInflateRaw(paths, -options.leaveStock, ...offsetArgs());

  return clipperInflateRaw(paths, -options.toolSize / 2, ...offsetArgs());
}

async function getShapeOutlines(
  currentPaths: PathsD,
  options: {
    leaveStock: number;
    toolSize: number;
    toolEngagement: number;
    start: CamPoint;
  },
): Promise<PathD[]> {
  const outlines: PathD[] = [];
  const stepSize = -options.toolSize * options.toolEngagement;
  let firstStep = true;
  while (true) {
    // get the next outline
    currentPaths = firstStep
      ? await toolCenterArea(currentPaths, options)
      : await clipperInflateRaw(currentPaths, stepSize, ...offsetArgs());

    firstStep = false;

    // no polygons, end.
    const pathsSize = currentPaths.size();
    if (!pathsSize) {
      break;
    }

    // insert the polygons so that there's minimum amount of travel
    const currentBatch: PathD[] = [];
    for (let i = 0; i < pathsSize; i++) {
      const path = currentPaths.get(i);
      const simplified = await simplifyPath(path, precision());
      currentBatch.push(simplified);
      path.delete();
    }

    if (outlines.length === 0) {
      outlines.push(...currentBatch);
    } else {
      const areas = new Map<PathD, number>();
      const areaResolver = await getAreaResolver();
      const getAreaAndCache = (path: PathD) => {
        const cached = areas.get(path);
        if (typeof cached === 'number') {
          return cached;
        }

        const area = areaResolver(path);
        areas.set(path, area);
        return area;
      };
      currentBatch.sort((a, b) => {
        const areaA = getAreaAndCache(a);
        const areaB = getAreaAndCache(b);
        return areaB - areaA;
      });

      // insert the polygons so that there's minimum amount of travel
      for (const path of currentBatch) {
        let inserted = false;
        for (const testOutline of outlines) {
          if (await pathsIntersect(path, testOutline, decimals())) {
            const index = outlines.indexOf(testOutline);
            outlines.splice(index, 0, path);
            inserted = true;
            break;
          }
        }

        if (!inserted) {
          //TODO: all outlines should intersect with the previous batch
          //since they are generated from it
          path.delete();
          // outlines.push(path);

          console.log('orphan path :(');
        }
      }
    }
  }

  return outlines;
}

/**
 * Group polygons so that intersecting ones are processed together.
 * This is to optimize travel and go depth first
 */
async function groupShapes(input: CamShape[]) {
  const polygons = input.flatMap((p) => p.polygons).map((p) => p.points);
  const paths = await makePaths(polygons);

  const groups: PathsD[] = [];

  const pathsSize = paths.size();
  for (let i = 0; i < pathsSize; i++) {
    const test = paths.get(i);

    let found = false;
    for (const group of groups) {
      if (await pathIntersectsAnyFromGroup(test, group, decimals())) {
        group.push_back(test);
        found = true;
        break;
      }
    }

    if (!found) {
      const newGroup = await makePathsFromPath(test);
      groups.push(newGroup);
    }
  }

  return groups;
}

function sortPaths(input: PathsD[], start: CamPoint = { x: 0, y: 0 }) {
  if (input.length <= 1) {
    return input;
  }

  const centers = new Map<PathsD, CamPoint>(
    input.map((paths) => {
      const centroids: CamPoint[] = [];
      for (let i = 0; i < paths.size(); i++) {
        const path = paths.get(i);

        const allPoints: CamPoint[] = [];
        for (let j = 0; j < path.size(); j++) {
          const point = path.get(j);
          allPoints.push({ x: point.x, y: point.y });
        }
        centroids.push(getCentroid(allPoints));
      }

      const cx = centroids.reduce((s, a) => s + a.x, 0) / centroids.length;
      const cy = centroids.reduce((s, a) => s + a.y, 0) / centroids.length;

      return [paths, { x: cx, y: cy }];
    }),
  );

  return orderPoints(
    input.map((paths) => ({ ...centers.get(paths)!, paths })),
    start,
  ).map(({ paths }) => paths);
}

function getPoints(path: PathD): CamPoint[] {
  const size = path.size();
  const points: CamPoint[] = [];
  for (let i = 0; i < size; i++) {
    const point = path.get(i);
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

function findClosestPointIndex(pt: CamPoint, points: CamPoint[]) {
  return findClosestPointMapIndex(pt, points, (p) => p);
}

function findClosestPointMapIndex<T>(
  pt: CamPoint,
  items: T[],
  map: (item: T) => CamPoint,
) {
  let index = -1;
  let min = Infinity;

  for (let i = 0; i < items.length; i++) {
    const distance = getDistance(pt, map(items[i]));
    if (distance < min) {
      min = distance;
      index = i;
    }
  }

  return index;
}
