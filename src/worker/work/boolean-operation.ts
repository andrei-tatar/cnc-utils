import {
  clipperBooleanOperation,
  ClipperClipType,
  ClipperFillRule,
  makePaths,
} from '../../cam/clipper';
import { CamPolygon, CamShape } from '../../cam/types';
import { decimals, GeometrySettings, useGeometry } from '../../cam/geometry';

export async function applyBooleanOperation(
  shape1: CamShape[],
  shape2: CamShape[],
  clipType: ClipperClipType,
  fillRule: ClipperFillRule,
  resultShapeId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  const a = await makePaths(
    shape1.flatMap((p) => p.polygons).map((p) => p.points),
  );
  const b = await makePaths(
    shape2.flatMap((p) => p.polygons).map((p) => p.points),
  );
  const paths = await clipperBooleanOperation(
    a,
    b,
    clipType,
    fillRule,
    decimals(),
  );

  const pathsSize = paths.size();
  const result: CamShape = {
    polygons: [],
    sourceShapeId: resultShapeId,
  };

  for (let i = 0; i < pathsSize; i++) {
    const path = paths.get(i);
    const poly: CamPolygon = {
      points: [],
      close: true,
    };
    const pathSize = path.size();
    for (let j = 0; j < pathSize; j++) {
      const point = path.get(j);
      poly.points.push({ x: point.x, y: point.y });
    }

    result.polygons.push(poly);
  }

  return result.polygons.length ? [result] : [];
}
