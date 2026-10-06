import {
  clipperBooleanOperation,
  makePath,
  makePaths,
  simplifyPath,
} from '../../cam/clipper';
import { circlePolygon, CornerSelection, findCorners } from '../../cam/corners';
import { curveTolerance, decimals } from '../../cam/geometry';
import { CamPoint, CamPolygon, CamShape } from '../../cam/types';
import { toPoints } from '../../cam/vcarve-geometry';
import type { ModelType as DogboneParameters } from '../../app/model-editor/transforms/transform-dogbone';

/** Transforms that work through Clipper. */

export async function simplifyShapes(
  input: CamShape[],
  tolerance: number,
): Promise<CamShape[]> {
  if (!(tolerance > 0)) return input;
  const result: CamShape[] = [];
  for (const shape of input) {
    const polygons: CamPolygon[] = [];
    for (const poly of shape.polygons) {
      if (poly.points.length < 3) {
        polygons.push(poly);
        continue;
      }
      const path = await makePath(poly.points);
      const simple = await simplifyPath(path, tolerance, poly.close);
      const points: CamPoint[] = [];
      for (let i = 0; i < simple.size(); i++) {
        const p = simple.get(i);
        points.push({ x: p.x, y: p.y });
      }
      simple.delete();
      path.delete();
      if (points.length >= (poly.close ? 3 : 2)) {
        polygons.push({ points, close: poly.close });
      }
    }
    result.push({ sourceShapeId: shape.sourceShapeId, polygons });
  }
  return result;
}

/** The closed polygons as one region (even-odd), cleaned up by Clipper. */
async function region(closed: CamPoint[][]): Promise<CamPoint[][]> {
  const subject = await makePaths(closed);
  const none = await makePaths([]);
  const result = await clipperBooleanOperation(
    subject,
    none,
    'union',
    'even-odd',
    decimals(),
  );
  subject.delete();
  none.delete();
  return toPoints(result);
}

export async function dogbones(
  input: CamShape[],
  t: DogboneParameters,
): Promise<CamShape[]> {
  const sourceShapeId = input[0]?.sourceShapeId;
  const all = input.flatMap((s) => s.polygons);
  const open = all.filter((p) => !p.close);
  const filled = await region(
    all.filter((p) => p.close && p.points.length > 2).map((p) => p.points),
  );
  if (!filled.length || !(t.dogboneTool > 0)) return input;

  const selection: CornerSelection = {
    which: t.dogboneSide === 'inside' ? 'convex' : 'concave',
    maxAngle: (t.dogboneMaxAngle * Math.PI) / 180,
  };
  const radius = t.dogboneTool / 2 + Math.max(0, t.dogboneClearance);
  const reliefs: CamPoint[][] = [];
  for (const polygon of findCorners(
    filled.map((points) => ({ points, close: true })),
  )) {
    for (const corner of polygon.corners) {
      if (corner.convex === null || !isSelectedCorner(corner, selection))
        continue;
      // The tool's centre goes where its edge just reaches the corner: along
      // the bisector, or along one of the sides for a T-bone.
      let direction = corner.bisector;
      if (t.dogboneStyle !== 'dogbone') {
        const prevLonger = corner.lengthPrev >= corner.lengthNext;
        const intoLonger = t.dogboneStyle === 't-bone-long';
        // Moving the tool along a side notches into that side's wall.
        direction = prevLonger === intoLonger ? corner.toPrev : corner.toNext;
      }
      const center = {
        x: corner.point.x + direction.x * radius,
        y: corner.point.y + direction.y * radius,
      };
      reliefs.push(circlePolygon(center, radius, curveTolerance()).points);
    }
  }
  if (!reliefs.length) return input;

  const subject = await makePaths(filled);
  const clip = await makePaths(reliefs);
  const result = await clipperBooleanOperation(
    subject,
    clip,
    t.dogboneSide === 'inside' ? 'union' : 'difference',
    'non-zero',
    decimals(),
  );
  subject.delete();
  clip.delete();
  const polygons: CamPolygon[] = [
    ...toPoints(result).map((points) => ({ points, close: true })),
    ...open,
  ];
  return polygons.length ? [{ sourceShapeId, polygons }] : [];
}

function isSelectedCorner(
  corner: { angle: number; convex: boolean | null },
  selection: CornerSelection,
) {
  if (corner.angle > selection.maxAngle) return false;
  return selection.which === 'convex' ? corner.convex : !corner.convex;
}
