import {
  BooleanOp,
  booleanOperation,
  FillRule,
  normalize,
} from '../../cam/kernel';
import { CamPolygon, CamShape } from '../../cam/types';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import {
  combinePoints,
  pointPolygons,
  singlePoints,
} from '../../cam/point-sets';

/** A shape in a chain of boolean operations (see `applyBooleanOperations`). */
export type BooleanOperand = {
  shape: CamShape[];
  /** How it's combined with the result so far; ignored for the first. */
  operation?: BooleanOp;
};

export async function applyBooleanOperation(
  shape1: CamShape[],
  shape2: CamShape[],
  clipType: BooleanOp,
  fillRule: FillRule,
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
 *
 * Single points (drill points) are combined too, as a set of points beside
 * the region (`combinePoints`): a union of point patterns is all their
 * points, subtracting an area takes out the points in it.
 */
export async function applyBooleanOperations(
  operands: BooleanOperand[],
  fillRule: FillRule,
  resultShapeId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  if (!operands.length) {
    return [];
  }

  const polygonsOf = (shape: CamShape[]): CamPolygon[] =>
    shape.flatMap((p) => p.polygons).filter((p) => p.close);

  // Each shape read through the fill rule (a clean region, which non-zero
  // reads as it is), then combined with the result so far.
  const pointsOf = (shape: CamShape[]) =>
    singlePoints(shape.flatMap((p) => p.polygons));
  let result = await normalize(polygonsOf(operands[0].shape), fillRule);
  let points = pointsOf(operands[0].shape);
  for (let i = 1; i < operands.length; i++) {
    const { shape, operation = 'union' } = operands[i];
    const clip = await normalize(polygonsOf(shape), fillRule);
    points = combinePoints(
      { region: result, points },
      { region: clip, points: pointsOf(shape) },
      operation,
    );
    result = await booleanOperation(result, clip, operation, 'non-zero');
  }

  const output: CamShape = {
    polygons: [...result, ...pointPolygons(points)],
    sourceShapeId: resultShapeId,
  };

  // Tabs on the shapes combined stay where they are.
  const tabs = operands.flatMap(({ shape }) =>
    shape.flatMap((s) => s.tabs ?? []),
  );
  if (tabs.length) {
    output.tabs = tabs;
  }
  return output.polygons.length || tabs.length ? [output] : [];
}
