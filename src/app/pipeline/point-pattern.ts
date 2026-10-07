import { circlePolygon } from '../../cam/corners';
import { GeometrySettings } from '../../cam/geometry';
import {
  circlePoints,
  finitePoints,
  gridPoints,
} from '../../cam/point-patterns';
import { CamShape } from '../../cam/types';
import type { ModelType as PointsParameters } from '../model-editor/shapes/shape-points';
import {
  HINGE_SYSTEMS,
  ModelType as HingeCupParameters,
} from '../model-editor/shapes/shape-hinge-cup';
import { hingeCupPolygons } from '../../cam/hinge-cup';

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

/** A hinge cup shape: the cup and its screw holes (see shape-hinge-cup). */
export function hingeCup(
  t: HingeCupParameters,
  shapeId: string,
  geometry: GeometrySettings,
): CamShape[] {
  const system =
    t.hingeSystem === 'custom' ? null : HINGE_SYSTEMS[t.hingeSystem];
  const polygons = hingeCupPolygons(
    {
      cupDiameter: t.hingeCupDiameter ?? 35,
      boring: t.hingeBoring ?? 5,
      screwSpacing: system?.spacing ?? t.hingeScrewSpacing ?? 45,
      screwOffset: system?.offset ?? t.hingeScrewOffset ?? 9.5,
      screwDiameter: t.hingeScrewDiameter ?? 0,
      parts: t.hingeParts ?? 'both',
    },
    geometry.curveTolerance,
  ).filter((p) => p.points.every((q) => Number.isFinite(q.x + q.y)));
  return polygons.length ? [{ sourceShapeId: shapeId, polygons }] : [];
}
