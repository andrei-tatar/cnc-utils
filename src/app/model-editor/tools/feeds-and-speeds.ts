import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { DEFAULT_GCODE_OPTIONS } from '../../../cam/gcode-options';

/**
 * Feeds and speeds an operation can set for itself; anything left empty
 * comes from its tool (and from there the G-code section).
 */
export type ToolOverrides = {
  feedRate?: number | null;
  plungeFeedRate?: number | null;
  spindleSpeed?: number | null;
  /** Ramp in or plunge; 'tool' (or empty) follows the tool. */
  rampMode?: 'tool' | 'ramp' | 'plunge' | null;
  rampAngle?: number | null;
  /**
   * Feed rate, plunge rate and spindle speed worked out (for the tool, the
   * cut, the stock's wood and the machine) instead of typed.
   */
  autoFeeds?: boolean;
};

/** The feeds and speeds of a tool, with an operation's overrides on top. */
export function withOverrides<
  T extends {
    feedRate?: number | null;
    plungeFeedRate?: number | null;
    spindleSpeed?: number | null;
    ramp?: boolean;
    rampAngle?: number;
  },
>(tool: T, overrides: ToolOverrides): T {
  const set = (value: number | null | undefined) => !!value && value > 0;
  return {
    ...tool,
    feedRate: set(overrides.feedRate) ? overrides.feedRate : tool.feedRate,
    plungeFeedRate: set(overrides.plungeFeedRate)
      ? overrides.plungeFeedRate
      : tool.plungeFeedRate,
    spindleSpeed: set(overrides.spindleSpeed)
      ? overrides.spindleSpeed
      : tool.spindleSpeed,
    ramp:
      overrides.rampMode === 'ramp'
        ? true
        : overrides.rampMode === 'plunge'
          ? false
          : tool.ramp,
    rampAngle: set(overrides.rampAngle) ? overrides.rampAngle! : tool.rampAngle,
  };
}

/** The tool's feeds and speeds, grouped. */
export const toolFeedsAndSpeeds: FormlyFieldConfig = {
  wrappers: ['group'],
  props: {
    label: 'feeds & speeds',
    collapsible: true,
    // Open when a feed or speed is set, so it isn't missed.
    startOpen: (model: any) =>
      ['feedRate', 'plungeFeedRate', 'spindleSpeed'].some((k) =>
        typeof model?.[k] === 'string' ? /\S/.test(model[k]) : model?.[k] > 0,
      ),
  },
  fieldGroup: [
    {
      key: 'feedRate',
      type: 'number',
      props: {
        label: 'feed rate',
        placeholder: 'G-code default',
        description: 'mm/min; empty uses the G-code section’s feed rate',
        min: 0,
      },
    },
    {
      key: 'plungeFeedRate',
      type: 'number',
      props: {
        label: 'plunge fr',
        placeholder: 'G-code default',
        description: 'mm/min; empty uses the G-code section’s plunge rate',
        min: 0,
      },
    },
    {
      key: 'ramp',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'ramp in instead of plunging',
      },
    },
    {
      key: 'rampAngle',
      type: 'number',
      defaultValue: 3,
      props: {
        min: 0.5,
        max: 45,
        label: 'ramp angle',
        description:
          '° below horizontal; pockets and clearings go round each loop down to the next depth, profiles along the end of the loop (clear of tabs), v-carves along each groove into the depth it needs',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !field.model?.ramp,
      },
    },
    {
      key: 'spindleSpeed',
      type: 'number',
      props: {
        label: 'spindle speed',
        placeholder: 'G-code default',
        description:
          'RPM, used after changing to this tool (with spindle control on)',
        min: 0,
      },
    },
  ],
};

// Fixed lists: a new one on every check would keep rebuilding the select.
const rampOptions = {
  ramp: modeOptions('as the tool (ramp in)'),
  plunge: modeOptions('as the tool (plunge)'),
};

function modeOptions(toolLabel: string) {
  return [
    { value: 'tool', label: toolLabel },
    { value: 'ramp', label: 'ramp in' },
    { value: 'plunge', label: 'plunge' },
  ];
}

/** The operation's tool, from any of its fields. */
function operationTool(field: FormlyFieldConfig): any {
  const toolId = field.model?.toolId;
  return (rootModel(field)?.tools ?? []).find((t: any) => t.id === toolId);
}

/** What an empty override falls back to: the tool's, or the G-code default. */
function inherited(
  key: 'feedRate' | 'plungeFeedRate' | 'spindleSpeed',
  gcodeKey: 'carveFeedRate' | 'plungeFeedRate' | 'spindleSpeed',
) {
  return (field: FormlyFieldConfig) => {
    const fromTool = operationTool(field)?.[key];
    if (fromTool > 0) {
      return `${fromTool} (tool)`;
    }
    const gcode =
      rootModel(field)?.gcode?.[gcodeKey] ?? DEFAULT_GCODE_OPTIONS[gcodeKey];
    return `${gcode} (G-code)`;
  };
}

/**
 * Working the feeds and speeds out: a field that turns it on, and the
 * expressions for each input it fills in.
 */
export type FeedsCalculation = {
  field: FormlyFieldConfig;
  expressions(
    key: 'feedRate' | 'plungeFeedRate' | 'spindleSpeed',
  ): NonNullable<FormlyFieldConfig['expressions']>;
};

/**
 * The operation's overrides, grouped; all optional, after `calculate`'s
 * field. Ramping only applies to the operations listed in `rampTypes`.
 */
export function operationFeedsAndSpeeds(
  calculate: FeedsCalculation,
  rampTypes: readonly string[],
): FormlyFieldConfig {
  const hideUnlessRamps = (field: FormlyFieldConfig) =>
    !rampTypes.includes(field.model?.type);
  const ramps = (field: FormlyFieldConfig) => {
    const mode = field.model?.rampMode;
    return (
      mode === 'ramp' || (mode !== 'plunge' && !!operationTool(field)?.ramp)
    );
  };

  return {
    wrappers: ['group'],
    props: {
      label: 'feeds & speeds',
      description: 'empty uses the tool’s',
      collapsible: true,
      // Open when something's overridden by hand, so it isn't missed.
      startOpen: (model: any) =>
        (!model?.autoFeeds &&
          ['feedRate', 'plungeFeedRate', 'spindleSpeed'].some(
            (k) => model?.[k] > 0,
          )) ||
        model?.rampAngle > 0 ||
        ['ramp', 'plunge'].includes(model?.rampMode),
    },
    fieldGroup: [
      calculate.field,
      {
        key: 'feedRate',
        type: 'number',
        props: { label: 'feed rate', min: 0 },
        expressions: {
          'props.placeholder': inherited('feedRate', 'carveFeedRate'),
          ...calculate.expressions('feedRate'),
        },
      },
      {
        key: 'plungeFeedRate',
        type: 'number',
        props: { label: 'plunge fr', min: 0 },
        expressions: {
          'props.placeholder': inherited('plungeFeedRate', 'plungeFeedRate'),
          ...calculate.expressions('plungeFeedRate'),
        },
      },
      {
        key: 'rampMode',
        type: 'enum',
        defaultValue: 'tool',
        props: { label: 'ramp' },
        expressions: {
          hide: hideUnlessRamps,
          'props.options': (field: FormlyFieldConfig) =>
            operationTool(field)?.ramp ? rampOptions.ramp : rampOptions.plunge,
        },
      },
      {
        key: 'rampAngle',
        type: 'number',
        props: {
          label: 'ramp angle',
          description: '° below horizontal',
          min: 0.5,
          max: 45,
        },
        expressions: {
          hide: (field: FormlyFieldConfig) =>
            hideUnlessRamps(field) || !ramps(field),
          'props.placeholder': (field: FormlyFieldConfig) =>
            `${operationTool(field)?.rampAngle ?? 3} (tool)`,
        },
      },
      {
        key: 'spindleSpeed',
        type: 'number',
        props: { label: 'spindle speed', min: 0 },
        expressions: {
          'props.placeholder': inherited('spindleSpeed', 'spindleSpeed'),
          ...calculate.expressions('spindleSpeed'),
        },
      },
    ],
  };
}
