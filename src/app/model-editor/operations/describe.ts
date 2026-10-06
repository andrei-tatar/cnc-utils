import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel, shapeLabel } from '../shapes/describe';
import { toolLabel, ToolType } from '../tools';

/** All operations in the model, from any field in the form. */
export function allOperations(field: FormlyFieldConfig | undefined): any[] {
  return rootModel(field)?.operations ?? [];
}

/** A readable name built from the operation's settings, shape and tool. */
export function describeOperation(
  operation: any,
  shapes: Array<{ id?: string; name?: string; type?: string }>,
  tools: ToolType[],
  operations: any[] = [],
): string {
  const mm = (value: number) => `${Math.round(value * 100) / 100} mm`;
  const total = (start: number, perStep: number, steps: number) =>
    mm((+start || 0) + (+perStep || 0) * (+steps || 0));

  let what: string;
  switch (operation?.type) {
    case 'pocket':
      what = `pocket${operation.strategy === 'raster' ? ' raster' : ''} ${total(operation.startDepth, operation.depth, operation.steps)}`;
      break;
    case 'profile':
      what = `profile${partLabel(operation.mode)} ${operation.side ?? ''} ${total(operation.startDepth, operation.depth, operation.steps)}`;
      break;
    case 'flat':
      what = `flat ${total(0, operation.depthPerStep, operation.steps)}`;
      break;
    case 'v-carve':
      what = `v-carve${partLabel(operation.mode)} ${
        operation.unlimitedDepth ? 'full V' : `≤${mm(operation.maxDepth ?? 0)}`
      }`;
      break;
    case 'v-carve-clear':
      what = 'v-carve clearing';
      break;
    case 'drill':
      what = `drill ${total(operation.startDepth, operation.depth, 1)}${
        operation.peck > 0 ? ` peck ${mm(operation.peck)}` : ''
      }`;
      break;
    case 'helix':
      what = `helical bore ${total(operation.startDepth, operation.depth, 1)}`;
      break;
    case 'chamfer':
      what = `chamfer ${mm(operation.chamferWidth ?? 0)}`;
      break;
    case 'inlay-plug':
      what = 'inlay plug';
      break;
    case 'rest':
      what = 'rest machining';
      break;
    default:
      what = operation?.type ?? 'operation';
  }

  const shapeId = borrowedShapeId(operation, operations);
  const shape = shapes.find((s) => s.id === shapeId);
  const tool = tools.find((t) => t.id === operation?.toolId);
  return [what, shape && shapeLabel(shape, shapes), tool && toolLabel(tool)]
    .filter(Boolean)
    .join(' · ');
}

/** " holes" / " outlines" for an operation limited to part of its shape. */
function partLabel(mode: 'both' | 'holes' | 'contours' | undefined) {
  return mode === 'holes' ? ' holes' : mode === 'contours' ? ' outlines' : '';
}

/**
 * The shape an operation cuts: its own, or (clearing, inlay plugs, rest
 * machining) that of the operation it belongs to.
 */
export function borrowedShapeId(
  operation: any,
  operations: any[],
  depth = 0,
): string | undefined {
  const from =
    operation?.type === 'v-carve-clear' || operation?.type === 'inlay-plug'
      ? operation.vcarveOperationId
      : operation?.type === 'rest'
        ? operation.pocketOperationId
        : null;
  if (!from) {
    return operation?.shapeId;
  }
  const other = operations.find((o) => o.id === from);
  // A clearing for an inlay plug borrows twice; never loop.
  return depth < 3 ? borrowedShapeId(other, operations, depth + 1) : undefined;
}
