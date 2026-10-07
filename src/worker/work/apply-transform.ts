import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { CamPolygon, CamShape } from '../../cam/types';
import { inflatePaths } from '../../cam/kernel';
import { polygonsBounds } from '../../cam/arcs';
import { TransformParameters } from '../../app/model-editor/model';
import { applyConvexHull } from './convex-hull-transform';
import { containingPolygons } from '../../cam/polygon-nesting';
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
import { dogbones, simplifyShapes } from './kernel-transforms';
import { placeTabs } from '../../cam/tabs';
import { finitePoints } from '../../cam/point-patterns';

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

      case 'offset': {
        const polygons = await inflatePaths(
          input.flatMap((p) => p.polygons),
          transform.offset,
          transform.joinType,
          transform.endType,
          transform.miterLimit,
          transform.arcTolerance,
        );
        return polygons.length
          ? [{ polygons, sourceShapeId: input[0]?.sourceShapeId }]
          : [];
      }
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
              ? finitePoints(transform.tabPoints)
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
  const rectangle = (of: CamPolygon[]): CamPolygon | null => {
    const { minX: x0, maxX: x1, minY: y0, maxY: y1 } = polygonsBounds(of);
    if (!(x1 > x0) || !(y1 > y0)) {
      return null; // no area (a straight line or a point)
    }
    return {
      close: true,
      vertices: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    };
  };

  const polygons = input.flatMap((s) => s.polygons);
  if (of === 'shape') {
    const r = rectangle(polygons);
    return r ? [{ sourceShapeId, polygons: [r] }] : [];
  }
  const closed = polygons.filter((p) => p.close && p.vertices.length > 1);
  const parents = containingPolygons(closed);
  const holes = new Set(closed.filter((_, i) => parents[i].length % 2 === 1));
  return input.map((shape) => ({
    ...shape,
    polygons: shape.polygons
      .filter((p) => p.vertices.length && !holes.has(p))
      .map((p) => rectangle([p]))
      .filter((r): r is CamPolygon => r !== null),
  }));
}
