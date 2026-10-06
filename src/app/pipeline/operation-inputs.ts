import {
  ModelType,
  OperationParameters,
  OperationType,
  ToolParameters,
} from '../model-editor/model';
import { toolLabel } from '../model-editor/tools';
import { withOverrides } from '../model-editor/tools/feeds-and-speeds';
import { clearedFirst, VCarveSource, vCarveSource } from './vcarve-source';

/** How an operation's tool appears in the G-code. */
export type ToolInfo = {
  /** Position in the tools list, from 1 (T1, T2, …). */
  number: number;
  label: string;
  spindleSpeed?: number;
  /** Empty means the G-code section's defaults. */
  feedRate?: number;
  plungeFeedRate?: number;
};

/** An operation resolved against the rest of the model. */
export type OperationInputs = {
  operationParameters: OperationParameters;
  /** The shape it cuts (a v-carve clearing's is its v-carve's). */
  shapeId: string;
  /** Its tool's routing parameters, with the operation's overrides. */
  toolParameters: ToolParameters | null;
  source: VCarveSource | null;
  beyondCone: boolean;
  toolInfo: ToolInfo | null;
  enabled: boolean;
};

export function operationInputs(
  {
    id,
    expanded: _,
    name: __,
    shapeId,
    toolId,
    disabled,
    feedRate,
    plungeFeedRate,
    spindleSpeed,
    rampMode,
    rampAngle,
    ...operationParameters
  }: OperationType,
  { tools, operations }: Pick<ModelType, 'tools' | 'operations'>,
): OperationInputs {
  // The operation's own feeds and speeds win over its tool's.
  const found = tools.find((t) => t.id === toolId);
  const tool =
    found &&
    withOverrides(found, {
      feedRate,
      plungeFeedRate,
      spindleSpeed,
      rampMode,
      rampAngle,
    });
  // Spindle speed and feed rates only affect the G-code text, not the
  // routing.
  const toolParameters: ToolParameters | null = tool
    ? (({
        id: _,
        expanded: __,
        name: ___,
        spindleSpeed: ____,
        feedRate: _____,
        plungeFeedRate: ______,
        ...parameters
      }) => parameters)(tool)
    : null;

  // V-carve clearing borrows its shape, bit and depths from the v-carve it
  // clears for, so it follows any change made there.
  const source = vCarveSource(operationParameters, operations, tools);

  // Tools are numbered by their position in the tools list.
  const toolInfo: ToolInfo | null = tool
    ? {
        number: tools.indexOf(found!) + 1,
        label: toolLabel(tool),
        spindleSpeed: tool.spindleSpeed || undefined,
        feedRate: tool.feedRate || undefined,
        plungeFeedRate: tool.plungeFeedRate || undefined,
      }
    : null;

  return {
    operationParameters,
    shapeId: source ? source.shapeId : shapeId,
    toolParameters,
    source,
    beyondCone:
      operationParameters.type === 'v-carve' &&
      clearedFirst(id, operations, tools),
    toolInfo,
    enabled: !disabled,
  };
}
