import {
  BooleanOp,
  booleanOperation,
  FillRule,
  normalize,
} from '../../cam/kernel';
import { CamPolygon, CamShape } from '../../cam/types';
import { GeometrySettings, useGeometry } from '../../cam/geometry';

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
  let result = await normalize(polygonsOf(operands[0].shape), fillRule);
  for (let i = 1; i < operands.length; i++) {
    const { shape, operation } = operands[i];
    const clip = await normalize(polygonsOf(shape), fillRule);
    result = await booleanOperation(
      result,
      clip,
      operation ?? 'union',
      'non-zero',
    );
  }

  const output: CamShape = {
    polygons: result,
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
