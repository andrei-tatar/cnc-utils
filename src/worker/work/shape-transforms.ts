import {
  circlePolygon,
  CornerSelection,
  findCorners,
  roundCorners,
} from '../../cam/corners';
import { curveTolerance } from '../../cam/geometry';
import { containingPolygons } from '../../cam/polygon-nesting';
import {
  arcOf,
  forEachSegment,
  polygonsBounds,
  reversePolygon,
  transformPolygon,
} from '../../cam/arcs';
import { CamPoint, CamPolygon, CamShape } from '../../cam/types';
import type { ModelType as PolarParameters } from '../../app/model-editor/transforms/transform-polar';
import type { ModelType as FitParameters } from '../../app/model-editor/transforms/transform-fit';
import type { ModelType as MirrorParameters } from '../../app/model-editor/transforms/transform-mirror';
import type { ModelType as CentersParameters } from '../../app/model-editor/transforms/transform-centers';
import type { ModelType as CornersParameters } from '../../app/model-editor/transforms/transform-corners';

export type Box = { x: number; y: number; width: number; height: number };

/** The shapes' bounding box, arcs included. */
export function getBoundingBox(input: CamShape[]): Box {
  const { minX, minY, maxX, maxY } = polygonsBounds(
    input.flatMap((s) => s.polygons),
  );
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A point of the box named like `xmin-ycenter`. */
export function boxPoint(box: Box, name: string): CamPoint {
  const [ox, oy] = name.split('-').map((v) => v.substring(1));
  const at = (start: number, size: number, type: string) =>
    type === 'min' ? start : type === 'max' ? start + size : start + size / 2;
  return { x: at(box.x, box.width, ox), y: at(box.y, box.height, oy) };
}

/** An affine map: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export function applyAffine(m: Affine, { x, y }: CamPoint): CamPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function transformShapes(input: CamShape[], m: Affine): CamShape[] {
  return input.map((shape) => {
    const moved: CamShape = {
      sourceShapeId: shape.sourceShapeId,
      // Arcs stay arcs unless the map stretches them into ellipses.
      polygons: shape.polygons.map((poly) =>
        transformPolygon(poly, m, curveTolerance()),
      ),
    };
    if (shape.tabs) {
      moved.tabs = shape.tabs.map((tab) => ({
        ...tab,
        points: tab.points.map((p) => applyAffine(m, p)),
      }));
    }
    return moved;
  });
}

export function translation(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

/** Rotation by `degrees` (counter-clockwise) around `center`. */
export function rotationAround(center: CamPoint, degrees: number): Affine {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    c,
    s,
    -s,
    c,
    center.x - c * center.x + s * center.y,
    center.y - s * center.x - c * center.y,
  ];
}

/** Scaling by `sx`, `sy`, keeping `anchor` in place. */
export function scalingAround(
  anchor: CamPoint,
  sx: number,
  sy: number,
): Affine {
  return [sx, 0, 0, sy, anchor.x * (1 - sx), anchor.y * (1 - sy)];
}

export function polarArray(input: CamShape[], t: PolarParameters): CamShape[] {
  const box = getBoundingBox(input);
  if (!Number.isFinite(box.width)) return input;
  const ownCenter = boxPoint(box, 'xcenter-ycenter');
  const center =
    t.polarAround === 'point' ? { x: t.polarX, y: t.polarY } : ownCenter;
  const count = Math.max(1, Math.round(t.polarCount));
  // A full turn spaces the copies evenly (the last isn't on the first); a
  // part of one puts the first and last copies at its ends.
  const full = Math.abs(t.polarAngle) >= 360;
  const step = full
    ? (360 * Math.sign(t.polarAngle)) / count
    : count > 1
      ? t.polarAngle / (count - 1)
      : 0;

  const output: CamShape[] = [];
  for (let k = 0; k < count; k++) {
    const rotation = rotationAround(center, step * k);
    if (t.polarRotate) {
      output.push(...transformShapes(input, rotation));
    } else {
      // Move the shape's centre along the circle, without turning it.
      const moved = applyAffine(rotation, ownCenter);
      output.push(
        ...transformShapes(
          input,
          translation(moved.x - ownCenter.x, moved.y - ownCenter.y),
        ),
      );
    }
  }
  return output;
}

export function fitToSize(input: CamShape[], t: FitParameters): CamShape[] {
  const box = getBoundingBox(input);
  const sx =
    t.fitWidth && t.fitWidth > 0 && box.width > 0
      ? t.fitWidth / box.width
      : null;
  const sy =
    t.fitHeight && t.fitHeight > 0 && box.height > 0
      ? t.fitHeight / box.height
      : null;
  let scaleX: number;
  let scaleY: number;
  if (sx !== null && sy !== null) {
    if (t.fitKeepAspect) {
      scaleX = scaleY = Math.min(sx, sy);
    } else {
      scaleX = sx;
      scaleY = sy;
    }
  } else if (sx !== null || sy !== null) {
    scaleX = scaleY = (sx ?? sy)!;
  } else {
    return input;
  }
  const anchor = boxPoint(box, t.fitAround);
  return transformShapes(input, scalingAround(anchor, scaleX, scaleY));
}

export function mirrorCopy(input: CamShape[], t: MirrorParameters): CamShape[] {
  const box = getBoundingBox(input);
  if (!Number.isFinite(box.width)) return input;
  const vertical = t.mirrorAxis === 'vertical';
  const [start, size] = vertical ? [box.x, box.width] : [box.y, box.height];
  const line =
    t.mirrorAt === 'min'
      ? start
      : t.mirrorAt === 'max'
        ? start + size
        : t.mirrorAt === 'center'
          ? start + size / 2
          : t.mirrorValue;
  const matrix: Affine = vertical
    ? [-1, 0, 0, 1, 2 * line, 0]
    : [1, 0, 0, -1, 0, 2 * line];
  // Reversed, so outlines keep turning the same way after the flip.
  const mirrored = transformShapes(input, matrix).map((shape) => ({
    ...shape,
    polygons: shape.polygons.map((p) => reversePolygon(p)),
  }));
  return t.mirrorKeepOriginal ? [...input, ...mirrored] : mirrored;
}

/**
 * The centre of an outline (by area: the polygon of its vertices, plus the
 * circular segment between each arc and its chord), or of its bounding box.
 */
export function centerOf(polygon: CamPolygon): CamPoint {
  if (polygon.close && polygon.vertices.length > 1) {
    let area = 0;
    let mx = 0;
    let my = 0;
    forEachSegment(polygon, (a, b, bulge) => {
      const f = (a.x * b.y - b.x * a.y) / 2;
      area += f;
      mx += ((a.x + b.x) / 3) * f;
      my += ((a.y + b.y) / 3) * f;
      if (bulge) {
        const { center, radius, start, sweep } = arcOf(a, b, bulge);
        const segment = ((radius * radius) / 2) * (sweep - Math.sin(sweep));
        // The segment's centroid lies on the arc's bisector.
        const d =
          (4 * radius * Math.sin(sweep / 2) ** 3) /
          (3 * (sweep - Math.sin(sweep)));
        const mid = start + sweep / 2;
        area += segment;
        mx += (center.x + d * Math.cos(mid)) * segment;
        my += (center.y + d * Math.sin(mid)) * segment;
      }
    });
    if (Math.abs(area) > 1e-12) {
      return { x: mx / area, y: my / area };
    }
  }
  const box = getBoundingBox([{ sourceShapeId: '', polygons: [polygon] }]);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function centerMarks(
  input: CamShape[],
  t: CentersParameters,
): CamShape[] {
  const all = input.flatMap((s) => s.polygons);
  const closed = all.filter((p) => p.close && p.vertices.length > 1);
  const parents = containingPolygons(closed);
  const holes = new Set(closed.filter((_, i) => parents[i].length % 2 === 1));

  return input.map((shape) => {
    const marks = shape.polygons
      .filter(
        (p) => p.vertices.length && (t.centersOf === 'all' || !holes.has(p)),
      )
      .map((p): CamPolygon => {
        const center = centerOf(p);
        return t.centersRadius > 0
          ? circlePolygon(center, t.centersRadius)
          : { vertices: [center], close: false };
      });
    return {
      sourceShapeId: shape.sourceShapeId,
      polygons: t.centersKeepOriginal ? [...shape.polygons, ...marks] : marks,
    };
  });
}

export function shapeCorners(
  input: CamShape[],
  t: CornersParameters,
): CamShape[] {
  const selection: CornerSelection = {
    which: t.cornerWhich,
    maxAngle: (t.cornerMaxAngle * Math.PI) / 180,
  };
  // Analysed together, so holes are told from outlines across the shapes.
  const all = input.flatMap((s) => s.polygons);
  const analysed = findCorners(all);
  let k = 0;
  return input.map((shape) => ({
    sourceShapeId: shape.sourceShapeId,
    polygons: shape.polygons.map(() =>
      roundCorners(analysed[k++], t.cornerMode, t.cornerSize, selection),
    ),
  }));
}
