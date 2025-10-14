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
import { getCentroid } from './utils';

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
    startDepth: number;
  },
): Promise<GCodeBuilder> {
  let start: CamPoint = { x: 0, y: 0 };

  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0].sourceShapeId);

  const groups = await groupShapes(input);
  const sorted = sortPaths(groups, start);

  for (const shape of sorted) {
    const outlines = await getShapeOutlines(shape, { ...options, start });

    for (let step = 0; step < options.steps; step++) {
      builder.goToSafeHeight();
      const depth = options.startDepth + options.depthPerStep * (step + 1);

      let lastOutline: PathD | null = null;
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

    outlines.forEach((o) => o.delete());
  }

  sorted.forEach((s) => s.delete());

  return builder;
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
  //small grow to join any overlapping polygons
  currentPaths = await clipperInflateRaw(
    currentPaths,
    PRECISION * 2,
    ...COMMON_ARGS,
  );

  //shrink to leave stock and half tool size
  currentPaths = await clipperInflateRaw(
    currentPaths,
    -options.leaveStock,
    ...COMMON_ARGS,
  );

  const outlines: PathD[] = [];
  const stepSize = -options.toolSize * options.toolEngagement;
  let firstStep = true;
  while (true) {
    // get the next outline
    currentPaths = await clipperInflateRaw(
      currentPaths,
      firstStep ? -options.toolSize / 2 : stepSize,
      ...COMMON_ARGS,
    );

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
      const simplified = await simplifyPath(path, PRECISION);
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
      if (await pathIntersectsAnyFromGroup(test, group, PRECISION)) {
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

  const sortedShapes: PathsD[] = [];
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
