import {
  clipperBooleanOperation,
  ClipperClipType,
  ClipperFillRule,
  makePaths,
} from '../../cam/clipper';
import { CamPolygon, CamShape } from '../../cam/types';

export async function applyBooleanOperation(
  shape1: CamShape[],
  shape2: CamShape[],
  clipType: ClipperClipType,
  fillRule: ClipperFillRule,
  resultShapeId: string,
): Promise<CamShape[]> {
  const a = await makePaths(
    shape1.flatMap((p) => p.polygons).map((p) => p.points),
  );
  const b = await makePaths(
    shape2.flatMap((p) => p.polygons).map((p) => p.points),
  );
  const paths = await clipperBooleanOperation(a, b, clipType, fillRule, 1);

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
