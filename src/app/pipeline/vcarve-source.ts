import { ModelType, OperationParameters } from '../model-editor/model';

/** What a v-carve clearing borrows from the v-carve it clears for. */
export type VCarveSource = {
  shapeId: string;
  vToolSize: number;
  vAngle: number;
  tipDiameter: number;
  startDepth: number;
  maxDepth: number | null;
  beyondCone: boolean;
  mode: 'both' | 'holes' | 'contours';
};

/**
 * For a v-carve clearing operation: the v-carve it clears for (shape,
 * V-bit and depths). Null for other operations, or while that v-carve or
 * its V-bit is missing.
 */
export function vCarveSource(
  operation: OperationParameters,
  operations: ModelType['operations'],
  tools: ModelType['tools'],
): VCarveSource | null {
  if (operation.type !== 'v-carve-clear') {
    return null;
  }
  const vcarve = operations.find((o) => o.id === operation.vcarveOperationId);
  if (vcarve?.type !== 'v-carve') {
    return null;
  }
  const tool = tools.find((t) => t.id === vcarve.toolId);
  if (tool?.bitType !== 'v-bit') {
    return null;
  }
  return {
    shapeId: vcarve.shapeId,
    vToolSize: tool.diameter,
    vAngle: tool.vAngle,
    tipDiameter: tool.tipDiameter,
    startDepth: vcarve.startDepth,
    maxDepth: vcarve.unlimitedDepth ? null : vcarve.maxDepth,
    beyondCone: clearedFirst(vcarve.id, operations, tools),
    mode: vcarve.mode ?? 'both',
  };
}

/**
 * Whether v-carve `vcarveId` is preceded by a clearing for it that uses an
 * end mill. Then the groove's middle is gone before the V-bit arrives, so
 * it can carve below its cone without the shank meeting uncut material.
 */
export function clearedFirst(
  vcarveId: string,
  operations: ModelType['operations'],
  tools: ModelType['tools'],
): boolean {
  const vcarveIndex = operations.findIndex((o) => o.id === vcarveId);
  return operations.some(
    (o, index) =>
      index < vcarveIndex &&
      !o.disabled &&
      o.type === 'v-carve-clear' &&
      o.vcarveOperationId === vcarveId &&
      (tools.find((t) => t.id === o.toolId)?.bitType ?? 'end-mill') !== 'v-bit',
  );
}
