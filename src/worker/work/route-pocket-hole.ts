import { PathD } from 'clipper2-wasm/dist/clipper2z';
import {
  clipperInflateRaw,
  getAreaResolver,
  makePaths,
  pathsIntersect,
} from '../../cam/clipper';
import { CamShape, CamPoint } from '../../cam/types';
import { getDistance, pointsEqual } from '../../util';
import { GCodeBuilder } from '../../cam/gcode-builder';

const PRECISION = 0.01;
const MITER_LIMIT = 2;
const ARC_TOLERANCE = 0;
const COMMON_ARGS = [
  'round',
  'polygon',
  PRECISION,
  MITER_LIMIT,
  ARC_TOLERANCE,
] as const;

export async function routePocketHole(
  input: CamShape[],
  options: {
    toolSize: number;
    toolEngagement: number;
    leaveStock: number;
    depthPerStep: number;
    steps: number;
  },
): Promise<GCodeBuilder> {

  let start: CamPoint = { x: 0, y: 0 };
  let lastOutline: PathD | null = null;

  const builder = new GCodeBuilder();
  const sortedShapes = sortShapes(input, start);

  for (const shape of sortedShapes) {
    builder.sourceShapeId(shape.sourceShapeId);
    const outlines = await getShapeOutlines(shape, { ...options, start });

    for (let step = 0; step < options.steps; step++) {
      builder.goToSafeHeight();
      const depth = options.depthPerStep * (step + 1);

      for (const outline of outlines) {
        const intersectsLastOutline = lastOutline
          ? await pathsIntersect(outline, lastOutline, PRECISION)
          : false;

        lastOutline = outline;

        const outlinePoints = getPoints(outline);
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

        for (let i = 0; i < outlinePoints.length; i++) {
          const pt = outlinePoints[i];

          if (i === 0) {
            firstPoint = pt;
          }
          if (i === outlinePoints.length - 1) {
            lastPoint = pt;
          }

          if (builder.isAtSafetyHeight) {
            builder.travelTo(pt.x, pt.y);

            builder.plunge(-depth);
          } else {
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
  }

  return builder;
}

async function getShapeOutlines(input: CamShape, options: {
  leaveStock: number,
  toolSize: number,
  toolEngagement: number,
  start: CamPoint,
}): Promise<PathD[]> {
  const inputPolygons = input.polygons.map((p) => p.points);
  let currentPaths = await makePaths(inputPolygons);

  //small grow to join any overlapping polygons
  currentPaths = await clipperInflateRaw(
    currentPaths,
    PRECISION * 2,
    ...COMMON_ARGS,
  );

  //shrink to leave stock and half tool size
  currentPaths = await clipperInflateRaw(
    currentPaths,
    -options.leaveStock - options.toolSize / 2,
    ...COMMON_ARGS,
  );

  const outlines: PathD[] = [];
  const stepSize = -options.toolSize * options.toolEngagement;
  while (true) {
    // get the next outline
    currentPaths = await clipperInflateRaw(
      currentPaths,
      stepSize,
      ...COMMON_ARGS,
    );

    // no polygons, end.
    const pathsSize = currentPaths.size();
    if (!pathsSize) {
      break;
    }

    // insert the polygons so that there's minimum amount of travel
    const currentBatch: PathD[] = [];
    for (let i = 0; i < pathsSize; i++) {
      currentBatch.push(currentPaths.get(i));
    }

    if (outlines.length === 0) {
      // this is the first batch, sort it
      const centers = new Map<PathD, CamPoint>(
        currentBatch.map((path) => {
          let cx = 0,
            cy = 0;
          const pathSize = path.size();
          for (let i = 0; i < pathSize; i++) {
            const p = path.get(i);
            cx += p.x;
            cy += p.y;
          }
          cx /= pathSize;
          cy /= pathSize;

          return [path, { x: cx, y: cy }];
        }),
      );

      let start: CamPoint = options.start;
      const sortedBatch: PathD[] = [];

      while (currentBatch.length) {
        const closestPathIndex = findClosestPointMapIndex(
          start,
          currentBatch,
          (i) => centers.get(i)!,
        );

        const closestPath = currentBatch[closestPathIndex];
        sortedBatch.push(closestPath);
        currentBatch.splice(closestPathIndex, 1);
        start = centers.get(closestPath)!;
      }

      outlines.push(...sortedBatch);
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
          if (await pathsIntersect(path, testOutline, PRECISION)) {
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

          console.log('orphan path :(');
        }
      }
    }
  }

  return outlines;
}

function sortShapes(input: CamShape[], start: CamPoint = { x: 0, y: 0 }): CamShape[] {
  // this is the first batch, sort it
  const centers = new Map<CamShape, CamPoint>(
    input.map((shape) => {
      let cx = 0,
        cy = 0;
      const allPoints = shape.polygons.flatMap(p => p.points);
      for (const p of allPoints) {
        cx += p.x;
        cy += p.y;
      }
      cx /= allPoints.length;
      cy /= allPoints.length;

      return [shape, { x: cx, y: cy }];
    }),
  );

  const sortedShapes: CamShape[] = [];
  const toSort = [...input];

  while (toSort.length) {
    const closestPathIndex = findClosestPointMapIndex(
      start,
      toSort,
      (i) => centers.get(i)!,
    );

    const closestPath = toSort[closestPathIndex];
    sortedShapes.push(closestPath);
    toSort.splice(closestPathIndex, 1);
    start = centers.get(closestPath)!;
  }

  return sortedShapes;
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
