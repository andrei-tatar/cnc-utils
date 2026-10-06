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
  props: { label: 'feeds & speeds' },
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
      defaultValue: false,
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
          '° below horizontal; pockets and clearings go round each loop down to the next depth, profiles along the end of the loop (clear of tabs)',
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
 * The operation's overrides, grouped; all optional. Ramping only applies to
 * the operations listed in `rampTypes`.
 */
export function operationFeedsAndSpeeds(
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
      // Open when something's overridden, so it isn't missed.
      startOpen: (model: any) =>
        ['feedRate', 'plungeFeedRate', 'spindleSpeed', 'rampAngle'].some(
          (k) => model?.[k] > 0,
        ) || ['ramp', 'plunge'].includes(model?.rampMode),
    },
    fieldGroup: [
      {
        key: 'feedRate',
        type: 'number',
        props: { label: 'feed rate', min: 0 },
        expressions: {
          'props.placeholder': inherited('feedRate', 'carveFeedRate'),
        },
      },
      {
        key: 'plungeFeedRate',
        type: 'number',
        props: { label: 'plunge fr', min: 0 },
        expressions: {
          'props.placeholder': inherited('plungeFeedRate', 'plungeFeedRate'),
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
        },
      },
    ],
  };
}
