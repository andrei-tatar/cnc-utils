import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { CamPoint, CamShape } from '../../cam/types';
import { lazy, pointsEqual } from '../../util';
import { makePath, simplifyPath } from '../../cam/clipper';

const patchApi = lazy(async () => {
  const xmlDom = await import('xmldom' as any);
  globalThis.DOMParser = xmlDom.DOMParser ?? xmlDom.default.DOMParser;
});

const svgLoader = new SVGLoader();

export async function importSvg(
  svgText: string,
  sourceId: string,
): Promise<CamShape[]> {
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
      let points: CamPoint[] = shape.getPoints(300);
      const closedPolygon =
        shape.autoClose || pointsEqual(points[0], points[points.length - 1]);

      if (closedPolygon) {
        // simplify closed polygons

        const path = await makePath(points);
        const simplified = await simplifyPath(path, 0.01);

        const simplifiedSize = simplified.size();
        points = [];
        for (let i = 0; i < simplifiedSize; i++) {
          const point = simplified.get(i);
          points.push({ x: point.x, y: point.y });
        }

        simplified.delete();
        path.delete();
      }

      camShape.polygons.push({
        points,
        close: closedPolygon,
      });
    }
  }

  return shapes;
}
