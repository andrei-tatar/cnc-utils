import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Curve, Path, Vector2 } from 'three';
import { CamPoint, CamShape, CamVertex } from '../../cam/types';
import { lazy, pointsEqual } from '../../util';
import {
  circularArc,
  cubic,
  fitBiarcs,
  ParametricCurve,
  quadratic,
} from '../../cam/biarc';
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
      const outline = pathVertices(shape);
      if (!outline) {
        continue;
      }
      const { vertices, start, end } = outline;
      const close = shape.autoClose || pointsEqual(start, end);
      if (!close || !pointsEqual(start, end)) {
        vertices.push({ x: end.x, y: end.y });
      }
      const merged = withoutRepeats(vertices, close);
      if (merged.length < 2 && !(close && merged.some((v) => v.bulge))) {
        continue;
      }
      camShape.polygons.push({ vertices: merged, close });
    }
  }

  return shapes;
}

/**
 * A path's segments as lines and arcs: circular arcs as they are, other
 * curves (Béziers, ellipses) fitted with arcs within the curve tolerance.
 * Vertices from each segment's start (the path's end not included).
 */
function pathVertices(
  path: Path,
): { vertices: CamVertex[]; start: CamPoint; end: CamPoint } | null {
  const curves = path.curves as Curve<Vector2>[];
  if (!curves.length) {
    return null;
  }
  const vertices: CamVertex[] = [];
  for (const curve of curves) {
    vertices.push(...curveVertices(curve));
  }
  const first = curves[0].getPoint(0);
  const last = curves[curves.length - 1].getPoint(1);
  return {
    vertices,
    start: { x: first.x, y: first.y },
    end: { x: last.x, y: last.y },
  };
}

function curveVertices(curve: Curve<Vector2>): CamVertex[] {
  const c = curve as any;
  const tolerance = curveTolerance();
  if (c.isLineCurve) {
    return [{ x: c.v1.x, y: c.v1.y }];
  }
  if (c.isQuadraticBezierCurve) {
    return fitBiarcs(quadratic(c.v0, c.v1, c.v2), tolerance);
  }
  if (c.isCubicBezierCurve) {
    return fitBiarcs(cubic(c.v0, c.v1, c.v2, c.v3), tolerance);
  }
  if (c.isEllipseCurve) {
    const sweep = ellipseSweep(c);
    const rx = Math.abs(c.xRadius);
    const ry = Math.abs(c.yRadius);
    if (Math.abs(rx - ry) <= 1e-9 * Math.max(rx, ry, 1)) {
      if (!sweep || !rx) return [];
      return circularArc(
        { x: c.aX, y: c.aY },
        rx,
        c.aStartAngle + (c.aRotation ?? 0),
        sweep,
      );
    }
  }
  // Anything else (ellipses, splines): fitted from its points.
  return fitBiarcs(threeCurve(curve), tolerance);
}

/** The sweep of three's EllipseCurve, as its getPoint works it out. */
function ellipseSweep(c: {
  aStartAngle: number;
  aEndAngle: number;
  aClockwise: boolean;
}): number {
  const twoPi = Math.PI * 2;
  let delta = c.aEndAngle - c.aStartAngle;
  const samePoints = Math.abs(delta) < Number.EPSILON;
  while (delta < 0) delta += twoPi;
  while (delta > twoPi) delta -= twoPi;
  if (delta < Number.EPSILON) {
    delta = samePoints ? 0 : twoPi;
  }
  if (c.aClockwise && !samePoints) {
    delta = delta === twoPi ? -twoPi : delta - twoPi;
  }
  return delta;
}

function threeCurve(curve: Curve<Vector2>): ParametricCurve {
  return {
    point: (t) => {
      const p = curve.getPoint(t);
      return { x: p.x, y: p.y };
    },
    tangent: (t) => {
      const p = curve.getTangent(t);
      return { x: p.x, y: p.y };
    },
  };
}

/** Consecutive vertices at the same place merged (the later's bulge kept). */
function withoutRepeats(vertices: CamVertex[], close: boolean): CamVertex[] {
  const out: CamVertex[] = [];
  for (const v of vertices) {
    const last = out[out.length - 1];
    if (last && Math.hypot(v.x - last.x, v.y - last.y) < 1e-9) {
      out[out.length - 1] = v;
    } else {
      out.push(v);
    }
  }
  if (close && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
      out.pop();
    }
  }
  return out;
}
