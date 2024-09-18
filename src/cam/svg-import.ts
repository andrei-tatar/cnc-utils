import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { CamShape } from './types';

const svgLoader = new SVGLoader();

export function importSvg(svg: string, sourceId: string) {
  const shapes: CamShape[] = [];

  const parsed = svgLoader.parse(svg);
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
