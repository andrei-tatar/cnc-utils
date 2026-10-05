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
  // Workers have no DOMParser; SVGLoader needs one.
  const xmlDom: any = await import('@xmldom/xmldom');
  const Parser = xmlDom.DOMParser ?? xmlDom.default.DOMParser;
  globalThis.DOMParser = Parser as typeof DOMParser;

  // SVGLoader looks gradients up with querySelectorAll, which xmldom lacks;
  // it only asks for tag names ("linearGradient, radialGradient", "stop").
  const doc = new Parser().parseFromString('<svg/>', 'image/svg+xml');
  for (const proto of [
    Object.getPrototypeOf(doc),
    Object.getPrototypeOf(doc.documentElement),
  ]) {
    if (!proto.querySelectorAll) {
      proto.querySelectorAll = function (selectors: string) {
        return elementsByTagNames(this, selectors);
      };
    }
  }
});

/**
 * The elements under `root` whose tag is one of the comma-separated
 * `selectors`, in document order (only plain tag names are supported).
 */
function elementsByTagNames(root: any, selectors: string): any[] {
  const names = new Set(selectors.split(',').map((s) => s.trim()));
  const found: any[] = [];
  const walk = (node: any) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        if (names.has(child.localName ?? child.nodeName)) {
          found.push(child);
        }
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

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
