import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { CamShape } from './types';
import { Matrix3 } from 'three';
import { transformPath } from './path-transform';

const svgLoader = new SVGLoader();

export function importSvg(svg: string, transform: Matrix3) {
  const shapes: CamShape[] = [];

  const parsed = svgLoader.parse(svg);
  for (const path of parsed.paths) {
    transformPath(path, transform);

    const camShape: CamShape = {
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
