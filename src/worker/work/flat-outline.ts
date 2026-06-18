import { CamPoint, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { applyTransform } from './apply-transform';
import { applyBooleanOperation } from './boolean-operation';

export async function flatOutline(
  input: CamShape[],
  options: {
    toolSize: number;
    toolEngagement: number;
    depth: number;
    steps: number;
    interpolateStepSize: boolean;
    allPassesInSameDirection: boolean;
    alongAxis: 'x' | 'y';
    growByToolsize: boolean;
    applyConvexHullOnShape: boolean;
    pauseAfterEachStep: boolean;
  },
): Promise<GCodeBuilder> {
  if (options.growByToolsize) {
    input = await applyTransform(input, {
      type: 'clipper-inflate',
      offset: options.toolSize * 0.5,
      endType: 'polygon',
      joinType: 'round',
      miterLimit: 0,
      precision: 0.01,
      arcTolerance: 2,
    });
  }

  if (options.applyConvexHullOnShape) {
    input = await applyTransform(input, {
      type: 'convexhull',
      mergeAllShapes: true,
    });
  }

  const alongAxis = options.alongAxis;
  const normalAxis = alongAxis === 'y' ? 'x' : 'y';

  function getPoint(normal: number, along: number): CamPoint {
    const x = alongAxis === 'x' ? along : normal;
    const y = alongAxis === 'y' ? along : normal;
    return { x, y };
  }

  function getCoords(normal: number, along: number): [x: number, y: number] {
    const { x, y } = getPoint(normal, along);
    return [x, y];
  }

  let minNormal = Infinity,
    maxNormal = -Infinity;
  for (const p of input.flatMap((i) => i.polygons.flatMap((p) => p.points))) {
    minNormal = Math.min(minNormal, p[normalAxis]);
    maxNormal = Math.max(maxNormal, p[normalAxis]);
  }

  const idealStepSize = options.toolSize * options.toolEngagement;
  let normalStepSize = idealStepSize;

  if (options.interpolateStepSize) {
    const normalLength = maxNormal - minNormal;
    const steps = normalLength / normalStepSize;
    if (Math.floor(steps) !== steps) {
      normalStepSize = normalLength / Math.ceil(steps) - 0.001;
    }
  }

  let isAtMinAlongAxis = false;

  const builders = new Array(options.steps).fill(0).map((_) => {
    const builder = new GCodeBuilder();
    builder.sourceShapeId(input[0]?.sourceShapeId);
    builder.goToSafeHeight();
    return builder;
  });

  let normal = minNormal;
  while (normal <= maxNormal) {
    const DISTANCE = 10e3;
    const pathPolygon: CamShape[] = [
      {
        polygons: [
          {
            close: true,
            points: [
              getPoint(normal - options.toolSize / 2, -DISTANCE),
              getPoint(normal + options.toolSize / 2, -DISTANCE),
              getPoint(normal + options.toolSize / 2, DISTANCE),
              getPoint(normal - options.toolSize / 2, DISTANCE),
            ],
          },
        ],
        sourceShapeId: '',
      },
    ];

    const intersection = await applyBooleanOperation(
      input,
      pathPolygon,
      'intersection',
      'non-zero',
      '',
    );
    const intersectionPolygons = intersection.flatMap((i) => i.polygons);
    if (!intersectionPolygons.length) {
      normal += normalStepSize;
      continue;
    }

    const intersectionPoints = intersectionPolygons.flatMap((p) => p.points);

    const alongAxisCoords = intersectionPoints.map((p) => p[alongAxis]);
    let minAlongAxis = Math.min(...alongAxisCoords);
    let maxAlongAxis = Math.max(...alongAxisCoords);

    if (Math.abs(minAlongAxis - maxAlongAxis) < idealStepSize) {
      minAlongAxis -= idealStepSize / 2;
      maxAlongAxis += idealStepSize / 2;
    }

    for (let i = 0; i < options.steps; i++) {
      const builder = builders[i];
      const depth = options.depth * (i + 1);

      if (i === options.steps - 1 && options.allPassesInSameDirection) {
        builder.travelTo(...getCoords(normal, minAlongAxis));
        builder.plunge(-depth);
        builder.carveTo(...getCoords(normal, maxAlongAxis));
        builder.goToSafeHeight();
      } else {
        if (builder.isAtSafetyHeight) {
          builder.travelTo(
            ...getCoords(
              normal,
              isAtMinAlongAxis ? maxAlongAxis : minAlongAxis,
            ),
          );
          builder.plunge(-depth);
        } else {
          builder.carveTo(
            ...getCoords(
              normal,
              isAtMinAlongAxis ? maxAlongAxis : minAlongAxis,
            ),
          );
        }
        builder.carveTo(
          ...getCoords(normal, isAtMinAlongAxis ? minAlongAxis : maxAlongAxis),
        );
      }
    }
    normal += normalStepSize;
    isAtMinAlongAxis = !isAtMinAlongAxis;
  }

  if (options.pauseAfterEachStep) {
    // skip the last step: the program ends right after it, so a pause there
    // would just force the operator to resume into the final stop
    for (const builder of builders.slice(0, -1)) {
      builder.goToSafeHeight();
      builder.pause();
    }
  }

  return builders.length
    ? builders.reduce((a, b) => a.concat(b))
    : new GCodeBuilder();
}
