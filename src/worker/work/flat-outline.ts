import { CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { applyTransform } from './apply-transform';

export async function flatOutline(
  input: CamShape[],
  options: {
    toolSize: number;
    toolEngagement: number;
    depth: number;
    interpolateStepSize: boolean;
    allPassesInSameDirection: boolean;
    alongAxis: 'x' | 'y';
    growByToolsize: boolean;
  },
): Promise<GCodeBuilder> {
  if (options.growByToolsize) {
    input = await applyTransform(input, {
      type: 'clipper-inflate',
      offset: options.toolSize * 0.6,
      endType: 'polygon',
      joinType: 'round',
      miterLimit: 0,
      precision: 0.01,
      arcTolerance: 2,
    });
  }

  input = await applyTransform(input, {
    type: 'convexhull',
    atShapeLevel: false,
  });

  const allPolygons = input.flatMap((v) => v.polygons);

  const alongAxis = options.alongAxis;
  const normalAxis = alongAxis === 'y' ? 'x' : 'y';

  function getCoords(normal: number, along: number): [x: number, y: number] {
    const x = alongAxis === 'x' ? along : normal;
    const y = alongAxis === 'y' ? along : normal;
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

  const builder = new GCodeBuilder();

  builder.sourceShapeId(input[0]?.sourceShapeId);
  builder.goToSafeHeight();

  let isAtMinAlongAxis = false;

  let normal = minNormal;
  while (normal <= maxNormal) {
    let minAlongAxis = Infinity,
      maxAlongAxis = -Infinity;

    for (const poly of allPolygons) {
      const lastPoint = poly.close
        ? poly.points.length
        : poly.points.length - 1;
      for (let i = 0; i < lastPoint; i++) {
        const p1 = poly.points[i];
        const p2 = poly.points[i === poly.points.length - 1 ? 0 : i + 1];

        if (
          (normal >= p1[normalAxis] && normal <= p2[normalAxis]) ||
          (normal >= p2[normalAxis] && normal <= p1[normalAxis])
        ) {
          const m =
            (p2[alongAxis] - p1[alongAxis]) / (p2[normalAxis] - p1[normalAxis]);

          if (m === Infinity || m === -Infinity) {
            minAlongAxis = Math.min(minAlongAxis, p1[alongAxis], p2[alongAxis]);
            maxAlongAxis = Math.max(maxAlongAxis, p1[alongAxis], p2[alongAxis]);
          } else {
            const alongAxisValue =
              p1[alongAxis] + m * (normal - p1[normalAxis]);
            minAlongAxis = Math.min(minAlongAxis, alongAxisValue);
            maxAlongAxis = Math.max(maxAlongAxis, alongAxisValue);
          }
        }
      }
    }

    if (minAlongAxis === Infinity) {
      break;
    }

    if (Math.abs(minAlongAxis - maxAlongAxis) < idealStepSize) {
      minAlongAxis -= idealStepSize / 2;
      maxAlongAxis += idealStepSize / 2;
    }

    if (options.allPassesInSameDirection) {
      builder.travelTo(...getCoords(normal, minAlongAxis));
      builder.plunge(-options.depth);
      builder.carveTo(...getCoords(normal, maxAlongAxis));
      builder.goToSafeHeight();
      normal += normalStepSize;
    } else {
      if (builder.isAtSafetyHeight) {
        builder.travelTo(
          ...getCoords(normal, isAtMinAlongAxis ? maxAlongAxis : minAlongAxis),
        );
        builder.plunge(-options.depth);
      } else {
        builder.carveTo(
          ...getCoords(normal, isAtMinAlongAxis ? maxAlongAxis : minAlongAxis),
        );
      }
      isAtMinAlongAxis = !isAtMinAlongAxis;
      builder.carveTo(
        ...getCoords(normal, isAtMinAlongAxis ? maxAlongAxis : minAlongAxis),
      );
      normal += normalStepSize;
    }
  }

  return builder;
}
