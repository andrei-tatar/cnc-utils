import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Curve, Path, Vector2 } from 'three';
import { CamPoint, CamShape } from '../../cam/types';
import { lazy, pointsEqual } from '../../util';
import { makePath, simplifyPath } from '../../cam/clipper';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';

const patchApi = lazy(async () => {
  const xmlDom = await import('xmldom' as any);
  globalThis.DOMParser = xmlDom.DOMParser ?? xmlDom.default.DOMParser;
});

const svgLoader = new SVGLoader();

/**
 * The tightest curve radius (mm) sampled finely enough to stay within the
 * curve tolerance; tighter bends are only a little over it.
 */
const MIN_RADIUS = 0.5;

export async function importSvg(
  svgText: string,
  sourceId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  await patchApi.value;

  const shapes: CamShape[] = [];

  const parsed = svgLoader.parse(svgText);
  for (const path of parsed.paths) {
    const camShape: CamShape = {
      sourceShapeId: sourceId,
      polygons: [],
    };
    shapes.push(camShape);

    for (const shape of path.subPaths) {
      const points = curvePoints(shape);
      if (points.length < 2) {
        continue;
      }
      const closedPolygon =
        shape.autoClose || pointsEqual(points[0], points[points.length - 1]);

      camShape.polygons.push({
        points: await simplified(points, closedPolygon),
        close: closedPolygon,
      });
    }
  }

  return shapes;
}

/**
 * Points along a path, close enough together that the polyline stays within
 * the curve tolerance (for bends down to MIN_RADIUS): a chord of length `s`
 * on radius `r` is `s² / 8r` off the arc.
 */
function curvePoints(path: Path): CamPoint[] {
  const spacing = Math.sqrt(8 * MIN_RADIUS * curveTolerance());
  const points: CamPoint[] = [];
  for (const curve of path.curves as Curve<Vector2>[]) {
    const isLine = (curve as any).isLineCurve;
    const divisions = isLine
      ? 1
      : Math.max(8, Math.ceil(curve.getLength() / spacing));
    const curvePoints = curve.getPoints(divisions);
    // Each curve starts where the previous one ended.
    for (const p of points.length ? curvePoints.slice(1) : curvePoints) {
      points.push({ x: p.x, y: p.y });
    }
  }
  return points;
}

/** Drop points that are within the curve tolerance of the line. */
async function simplified(
  points: CamPoint[],
  closed: boolean,
): Promise<CamPoint[]> {
  if (points.length < 3) {
    return points;
  }
  const path = await makePath(points);
  const result = await simplifyPath(path, curveTolerance(), closed);
  const size = result.size();
  const simple: CamPoint[] = [];
  for (let i = 0; i < size; i++) {
    const point = result.get(i);
    simple.push({ x: point.x, y: point.y });
  }
  result.delete();
  path.delete();
  return simple;
}
