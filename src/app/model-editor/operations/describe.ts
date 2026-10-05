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
      what = `pocket ${total(operation.startDepth, operation.depth, operation.steps)}`;
      break;
    case 'profile':
      what = `profile ${operation.side ?? ''} ${total(operation.startDepth, operation.depth, operation.steps)}`;
      break;
    case 'flat':
      what = `flat ${total(0, operation.depthPerStep, operation.steps)}`;
      break;
    case 'v-carve':
      what = `v-carve ≤${mm(operation.maxDepth ?? 0)}`;
      break;
    case 'v-carve-clear':
      what = 'v-carve clearing';
      break;
    default:
      what = operation?.type ?? 'operation';
  }

  // Clearing works on the shape of the v-carve it clears for.
  const shapeId =
    operation?.type === 'v-carve-clear'
      ? operations.find((o) => o.id === operation.vcarveOperationId)?.shapeId
      : operation?.shapeId;
  const shape = shapes.find((s) => s.id === shapeId);
  const tool = tools.find((t) => t.id === operation?.toolId);
  return [what, shape && shapeLabel(shape, shapes), tool && toolLabel(tool)]
    .filter(Boolean)
    .join(' · ');
}
