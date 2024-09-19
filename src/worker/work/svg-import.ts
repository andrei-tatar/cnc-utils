import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { CamShape } from '../../cam/types';
import { lazy } from '../../util';

const patchApi = lazy(async () => {
  const { DOMParser } = await import('xmldom' as any);
  globalThis.DOMParser = DOMParser;
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
      const points = shape.getPoints();
      camShape.polygons.push({
        points,
        close: shape.autoClose,
      });
    }
  }

  return shapes;
}
