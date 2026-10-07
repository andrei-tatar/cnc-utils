import { circlePolygon, CornerSelection, findCorners } from '../../cam/corners';
import { simplifyPolygon } from '../../cam/simplify';
import { booleanOperation, normalize } from '../../cam/kernel';
import { CamPolygon, CamShape } from '../../cam/types';
import type { ModelType as DogboneParameters } from '../../app/model-editor/transforms/transform-dogbone';

/** Transforms that work through the geometry kernel. */

export async function simplifyShapes(
  input: CamShape[],
  tolerance: number,
): Promise<CamShape[]> {
  if (!(tolerance > 0)) return input;
  return input.map((shape) => ({
    sourceShapeId: shape.sourceShapeId,
    polygons: shape.polygons.flatMap((poly) => {
      if (poly.vertices.length < 3) return [poly];
      const simple = simplifyPolygon(poly, tolerance);
      const enough =
        simple.vertices.length >= (poly.close ? 3 : 2) ||
        (poly.close && simple.vertices.length > 1 && simple.vertices.some((v) => v.bulge));
      return enough ? [simple] : [];
    }),
  }));
}

export async function dogbones(
  input: CamShape[],
  t: DogboneParameters,
): Promise<CamShape[]> {
  const sourceShapeId = input[0]?.sourceShapeId;
  const all = input.flatMap((s) => s.polygons);
  const open = all.filter((p) => !p.close);
  const filled = await normalize(
    all.filter((p) => p.close && p.vertices.length > 1),
    'even-odd',
  );
  if (!filled.length || !(t.dogboneTool > 0)) return input;

  const selection: CornerSelection = {
    which: t.dogboneSide === 'inside' ? 'convex' : 'concave',
    maxAngle: (t.dogboneMaxAngle * Math.PI) / 180,
  };
  const radius = t.dogboneTool / 2 + Math.max(0, t.dogboneClearance);
  const reliefs: CamPolygon[] = [];
  for (const polygon of findCorners(filled)) {
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
      reliefs.push(circlePolygon(center, radius));
    }
  }
  if (!reliefs.length) return input;

  const result = await booleanOperation(
    filled,
    reliefs,
    t.dogboneSide === 'inside' ? 'union' : 'difference',
    'non-zero',
  );
  const polygons: CamPolygon[] = [...result, ...open];
  return polygons.length ? [{ sourceShapeId, polygons }] : [];
}
function isSelectedCorner(
  corner: { angle: number; convex: boolean | null },
  selection: CornerSelection,
) {
  if (corner.angle > selection.maxAngle) return false;
  return selection.which === 'convex' ? corner.convex : !corner.convex;
}
