import {
  clipperBooleanOperation,
  ClipperClipType,
  ClipperFillRule,
  makePaths,
} from '../../cam/clipper';
import { CamPolygon, CamShape } from '../../cam/types';
import { decimals, GeometrySettings, useGeometry } from '../../cam/geometry';

/** A shape in a chain of boolean operations (see `applyBooleanOperations`). */
export type BooleanOperand = {
  shape: CamShape[];
  /** How it's combined with the result so far; ignored for the first. */
  operation?: ClipperClipType;
};

export async function applyBooleanOperation(
  shape1: CamShape[],
  shape2: CamShape[],
  clipType: ClipperClipType,
  fillRule: ClipperFillRule,
  resultShapeId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  return applyBooleanOperations(
    [{ shape: shape1 }, { shape: shape2, operation: clipType }],
    fillRule,
    resultShapeId,
    geometry,
  );
}

/**
 * Combines shapes in order: the first is the starting point, and each one
 * after it is combined with the result so far by its own operation.
 * `fillRule` decides what each shape covers.
 */
export async function applyBooleanOperations(
  operands: BooleanOperand[],
  fillRule: ClipperFillRule,
  resultShapeId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  if (!operands.length) {
    return [];
  }

  const regionOf = async (shape: CamShape[]) =>
    makePaths(shape.flatMap((p) => p.polygons).map((p) => p.points));

  let result = await regionOf(operands[0].shape);
  if (operands.length === 1) {
    // Still read through the fill rule, as with more shapes.
    result = await normalize(result, fillRule);
  }
  for (let i = 1; i < operands.length; i++) {
    const { shape, operation } = operands[i];
    // The first step reads both shapes through the fill rule. Its result is
    // a clean region (outers one way, holes the other), which non-zero
    // reads as it is whatever the fill rule, so later steps read the shape
    // being added through the fill rule first, then combine with non-zero.
    const first = i === 1;
    let clip = await regionOf(shape);
    if (!first) {
      clip = await normalize(clip, fillRule);
    }
    const combined = await clipperBooleanOperation(
      result,
      clip,
      operation ?? 'union',
      first ? fillRule : 'non-zero',
      decimals(),
    );
    result.delete();
    clip.delete();
    result = combined;
  }

  const pathsSize = result.size();
  const output: CamShape = {
    polygons: [],
    sourceShapeId: resultShapeId,
  };

  for (let i = 0; i < pathsSize; i++) {
    const path = result.get(i);
    const poly: CamPolygon = {
      points: [],
      close: true,
    };
    const pathSize = path.size();
    for (let j = 0; j < pathSize; j++) {
      const point = path.get(j);
      poly.points.push({ x: point.x, y: point.y });
    }

    output.polygons.push(poly);
  }
  result.delete();

  // Tabs on the shapes combined stay where they are.
  const tabs = operands.flatMap(({ shape }) =>
    shape.flatMap((s) => s.tabs ?? []),
  );
  if (tabs.length) {
    output.tabs = tabs;
  }
  return output.polygons.length || tabs.length ? [output] : [];
}

/**
 * The region `paths` cover under `fillRule`, as clean polygons. Takes
 * ownership of `paths`.
 */
async function normalize(
  paths: Awaited<ReturnType<typeof makePaths>>,
  fillRule: ClipperFillRule,
) {
  const empty = await makePaths([]);
  const result = await clipperBooleanOperation(
    paths,
    empty,
    'union',
    fillRule,
    decimals(),
  );
  paths.delete();
  empty.delete();
  return result;
}
