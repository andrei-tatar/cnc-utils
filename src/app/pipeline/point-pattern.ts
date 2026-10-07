import { circlePolygon } from '../../cam/corners';
import { GeometrySettings } from '../../cam/geometry';
import {
  circlePoints,
  finitePoints,
  gridPoints,
} from '../../cam/point-patterns';
import { CamShape } from '../../cam/types';
import type { ModelType as PointsParameters } from '../model-editor/shapes/shape-points';

/** A points shape: a point (or a round hole) at each of its positions. */
export function pointPattern(
  t: PointsParameters,
  shapeId: string,
  geometry: GeometrySettings,
): CamShape[] {
  const points =
    t.pointsMode === 'list'
      ? finitePoints(t.pointsList)
      : t.pointsMode === 'circle'
        ? circlePoints(t.circleCount, t.circleDiameter, t.circleStartAngle)
        : gridPoints(
            t.gridCountX,
            t.gridCountY,
            t.gridSpacingX,
            t.gridSpacingY,
          );
  if (!points.length) {
    return [];
  }
  const polygons = points.map((point) =>
    t.holeDiameter > 0
      ? circlePolygon(point, t.holeDiameter / 2, geometry.curveTolerance)
      : { points: [point], close: false },
  );
  return [{ sourceShapeId: shapeId, polygons }];
}
