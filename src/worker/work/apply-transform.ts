import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { CamPolygon, CamShape } from '../../cam/types';
import { clipperInflateRaw, makePaths } from '../../cam/clipper';
import { TransformParameters } from '../../app/model-editor/model';
import { applyConvexHull } from './convex-hull-transform';
import { pointInPolygon } from '../../cam/polygon-nesting';
import {
  boxPoint,
  centerMarks,
  fitToSize,
  getBoundingBox,
  mirrorCopy,
  polarArray,
  rotationAround,
  scalingAround,
  shapeCorners,
  transformShapes,
  translation,
} from './shape-transforms';
import { dogbones, simplifyShapes } from './clipper-transforms';
import { placeTabs } from '../../cam/tabs';
import { parsePointList } from '../../cam/point-patterns';

export async function applyTransform(
  input: CamShape[],
  transform: TransformParameters,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  return keepingTabs(input, await transformed(input, transform, geometry));
}

/**
 * The transform's output, keeping the input's tabs where the transform
 * didn't move them with the shape (it made new outlines): they stay where
 * they were.
 */
function keepingTabs(input: CamShape[], output: CamShape[]): CamShape[] {
  const tabs = input.flatMap((s) => s.tabs ?? []);
  if (!tabs.length || output.some((s) => s.tabs?.length)) {
    return output;
  }
  if (!output.length) {
    return [{ sourceShapeId: input[0].sourceShapeId, polygons: [], tabs }];
  }
  return [{ ...output[0], tabs }, ...output.slice(1)];
}

async function transformed(
  input: CamShape[],
  transform: TransformParameters,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  try {
    switch (transform.type) {
      case 'translate':
        return transformShapes(
          input,
          translation(transform.translateX, transform.translateY),
        );

      case 'align': {
        const box = getBoundingBox(input);
        if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) {
          return input; // nothing to align
        }
        // Y points up: top is the largest Y.
        const x = {
          none: null,
          left: box.x,
          middle: box.x + box.width / 2,
          right: box.x + box.width,
        }[transform.alignX];
        const y = {
          none: null,
          top: box.y + box.height,
          middle: box.y + box.height / 2,
          bottom: box.y,
        }[transform.alignY];
        return transformShapes(
          input,
          translation(
            x === null ? 0 : transform.alignXTo - x,
            y === null ? 0 : transform.alignYTo - y,
          ),
        );
      }

      case 'rotate': {
        const box = getBoundingBox(input);

        const center =
          transform.around === 'point'
            ? { x: transform.aroundX ?? 0, y: transform.aroundY ?? 0 }
            : boxPoint(box, transform.around);

        // Clockwise, as it has always turned (three's Matrix3.rotate did).
        return transformShapes(
          input,
          rotationAround(center, -transform.rotateAngle),
        );
      }

      case 'scale':
        return transformShapes(
          input,
          scalingAround({ x: 0, y: 0 }, transform.scaleX, transform.scaleY),
        );

      case 'repeat':
        const output: CamShape[] = [];

        const deltaX =
          transform.repeatTypeX === 'every'
            ? transform.repeatSpaceX
            : transform.repeatSpaceX / Math.max(1, transform.repeatCountX - 1);

        const deltaY =
          transform.repeatTypeY === 'every'
            ? transform.repeatSpaceY
            : transform.repeatSpaceY / Math.max(1, transform.repeatCountY - 1);

        for (let y = 0; y < transform.repeatCountY; y++)
          for (let x = 0; x < transform.repeatCountX; x++) {
            output.push(
              ...transformShapes(input, translation(deltaX * x, deltaY * y)),
            );
          }
        return output;

      case 'flip':
        // Mirrored in place, across the middle of its bounding box.
        return transformShapes(
          input,
          scalingAround(
            boxPoint(getBoundingBox(input), 'xcenter-ycenter'),
            transform.flipHorizontal ? -1 : 1,
            transform.flipVertical ? -1 : 1,
          ),
        );

      case 'clipper-inflate':
        let paths = await makePaths(
          input.flatMap((p) => p.polygons).map((p) => p.points),
        );

        paths = await clipperInflateRaw(
          paths,
          transform.offset,
          transform.joinType,
          transform.endType,
          // The transform's "precision" has always reached Clipper as the
          // miter limit and its "miter limit" as the decimal places; kept so
          // existing projects come out the same.
          transform.precision,
          transform.miterLimit,
          transform.arcTolerance,
        );

        const pathsSize = paths.size();
        const result: CamShape = {
          polygons: [],
          sourceShapeId: input[0]?.sourceShapeId,
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
      case 'bounds':
        return boundingRectangles(input, transform.boundsOf);

      case 'convexhull':
        return applyConvexHull(input, {
          atShapeLevel: transform.atShapeLevel,
          mergeAllShapes: transform.mergeAllShapes,
        });

      case 'polar':
        return polarArray(input, transform);

      case 'fit':
        return fitToSize(input, transform);

      case 'mirror':
        return mirrorCopy(input, transform);

      case 'simplify':
        return await simplifyShapes(input, transform.simplifyTolerance);

      case 'centers':
        return centerMarks(input, transform);

      case 'dogbone':
        return await dogbones(input, transform);

      case 'corners':
        return shapeCorners(input, transform);

      case 'tabs':
        return placeTabs(input, {
          on: transform.tabsOn,
          side: transform.tabSide,
          count: transform.tabCount,
          width: transform.tabWidth,
          length: transform.tabLength,
          depth: transform.tabDepth,
          offset: transform.tabOffset ?? 0,
          at:
            transform.tabPlacement === 'points'
              ? parsePointList(transform.tabPoints)
              : undefined,
        });

      default:
        return input;
    }
  } catch (err) {
    console.error(err);
  }
  return input;
}

/**
 * The rectangle around all of `input`, or around each of its polygons
 * except holes (polygons inside an odd number of others).
 */
function boundingRectangles(
  input: CamShape[],
  of: 'shape' | 'polygon',
): CamShape[] {
  const sourceShapeId = input[0]?.sourceShapeId;
  const rectangle = (points: CamPolygon['points']): CamPolygon | null => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [x0, x1, y0, y1] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    if (!(x1 > x0) || !(y1 > y0)) {
      return null; // no area (a straight line or a point)
    }
    return {
      close: true,
      points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    };
  };

  const polygons = input.flatMap((s) => s.polygons);
  if (of === 'shape') {
    const r = rectangle(polygons.flatMap((p) => p.points));
    return r ? [{ sourceShapeId, polygons: [r] }] : [];
  }
  const closed = polygons.filter((p) => p.close && p.points.length > 2);
  const isHole = (p: CamPolygon) =>
    p.close &&
    closed.filter((o) => o !== p && pointInPolygon(p.points[0], o.points))
      .length %
      2 ===
      1;
  return input.map((shape) => ({
    ...shape,
    polygons: shape.polygons
      .filter((p) => p.points.length && !isHole(p))
      .map((p) => rectangle(p.points))
      .filter((r): r is CamPolygon => r !== null),
  }));
}
