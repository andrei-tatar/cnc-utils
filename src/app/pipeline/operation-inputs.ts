import {
  ModelType,
  OperationParameters,
  OperationType,
  ToolParameters,
} from '../model-editor/model';
import { toolLabel, toolNumber } from '../model-editor/tools';
import { withOverrides } from '../model-editor/tools/feeds-and-speeds';
import {
  Clearing,
  clearingsBefore,
  FlatPlugSource,
  flatPlugSource,
  ImageEngraveSource,
  imageEngraveSource,
  PlugSource,
  plugSource,
  RestSource,
  restSource,
  VCarveSource,
  vCarveSource,
} from './vcarve-source';

/** How an operation's tool appears in the G-code. */
export type ToolInfo = {
  /** The tool's index (T1, T2, …), not its place in the list. */
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
  /**
   * The shape it cuts (a v-carve clearing's is its v-carve's, an inlay
   * plug's its pocket's, rest machining's its pocket's).
   */
  shapeId: string;
  /** Its tool's routing parameters, with the operation's overrides. */
  toolParameters: ToolParameters | null;
  source: VCarveSource | null;
  plug: PlugSource | null;
  rest: RestSource | null;
  flatPlug: FlatPlugSource | null;
  /** For an image engraving's clearing: the engraving. */
  imageEngrave: ImageEngraveSource | null;
  /**
   * For a v-carve or inlay plug: the end mills clearing for it first (see
   * clearingsBefore).
   */
  clearings: Clearing[];
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
    autoFeeds: ___,
    wrap: ____,
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
        index: _______,
        spindleSpeed: ____,
        feedRate: _____,
        plungeFeedRate: ______,
        fluteLength: ________,
        flutes: _________,
        ...parameters
      }) => parameters)(tool)
    : null;

  // V-carve clearing borrows its shape, bit and depths from the v-carve it
  // clears for, so it follows any change made there.
  const source = vCarveSource(operationParameters, operations, tools);
  const plug = plugSource(
    { ...operationParameters, toolId },
    operations,
    tools,
  );
  const rest = restSource(operationParameters, operations, tools);
  const flatPlug = flatPlugSource(operationParameters, operations, tools);
  const imageEngrave = imageEngraveSource(
    operationParameters,
    operations,
    tools,
  );

  const toolInfo: ToolInfo | null = tool
    ? {
        number: toolNumber(found!, tools),
        label: toolLabel(tool),
        spindleSpeed: tool.spindleSpeed || undefined,
        feedRate: tool.feedRate || undefined,
        plungeFeedRate: tool.plungeFeedRate || undefined,
      }
    : null;

  return {
    operationParameters,
    shapeId:
      (source ?? plug ?? rest ?? flatPlug ?? imageEngrave)?.shapeId ?? shapeId,
    toolParameters,
    source,
    plug,
    rest,
    flatPlug,
    imageEngrave,
    clearings:
      operationParameters.type === 'v-carve' ||
      operationParameters.type === 'inlay-plug'
        ? clearingsBefore(id, operations, tools)
        : [],
    toolInfo,
    enabled: !disabled,
  };
}
