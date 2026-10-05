import { shapeLabel } from '../shapes/describe';
import { toolLabel, ToolType } from '../tools';

/** A readable name built from the operation's settings, shape and tool. */
export function describeOperation(
  operation: any,
  shapes: Array<{ id?: string; name?: string; type?: string }>,
  tools: ToolType[],
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
    default:
      what = operation?.type ?? 'operation';
  }

  const shape = shapes.find((s) => s.id === operation?.shapeId);
  const tool = tools.find((t) => t.id === operation?.toolId);
  return [what, shape && shapeLabel(shape, shapes), tool && toolLabel(tool)]
    .filter(Boolean)
    .join(' · ');
}
