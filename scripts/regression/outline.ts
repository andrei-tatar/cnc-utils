import { CamPoint, CamPolygon } from '../../src/cam/types';

/** A polygon's outline as points (the harness compares points). */
export function outlinePoints(polygon: CamPolygon): CamPoint[] {
  return polygon.points;
}
