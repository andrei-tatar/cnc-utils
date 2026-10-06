import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { toolFeedsAndSpeeds } from './feeds-and-speeds';

export type BitType = 'end-mill' | 'v-bit';

const hideUnlessVBit = (field: FormlyFieldConfig) =>
  field.model?.bitType !== 'v-bit';

export type ToolType = {
  id: string;
  expanded: boolean;

  name?: string;
  bitType?: BitType;
  diameter: number;
  vAngle: number;
  tipDiameter: number;
  /** Optional; overrides the G-code section's carve feed rate. */
  feedRate?: number | null;
  /** Optional; overrides the G-code section's plunge feed rate. */
  plungeFeedRate?: number | null;
  /** Optional; overrides the G-code section's spindle speed. */
  spindleSpeed?: number | null;
  /**
   * Ramp down into cuts along the toolpath instead of plunging (pocket,
   * profile and v-carve clearing).
   */
  ramp?: boolean;
  /** Degrees below horizontal. */
  rampAngle?: number;
};

export type ModelType = {
  tools: Array<ToolType>;
};

/** All tools in the model, from any field in the form. */
export function allTools(field: FormlyFieldConfig | undefined): ToolType[] {
  return rootModel(field)?.tools ?? [];
}

/** The tool's own name, or one built from its settings. */
export function toolLabel(tool: Partial<ToolType> | undefined): string {
  return tool?.name || describeTool(tool);
}

/** A readable name built from the tool's settings, e.g. "Ø6 mm 60° v-bit". */
export function describeTool(tool: Partial<ToolType> | undefined): string {
  const parts: string[] = [];
  if (tool?.diameter) {
    parts.push(`Ø${tool.diameter} mm`);
  }
  if (tool?.bitType === 'v-bit') {
    if (tool.vAngle) {
      parts.push(`${tool.vAngle}°`);
    }
    parts.push('v-bit');
    if (tool.tipDiameter) {
      parts.push(`(${tool.tipDiameter} mm tip)`);
    }
  } else {
    parts.push('end mill');
  }
  return parts.join(' ');
}

export const field: FormlyFieldConfig = {
  key: 'tools',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'tools',
    itemLabel: 'tool',
    describeItem: describeTool,
    accent: '#ea580c',
    collapsible: true,
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'expanded',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeTool(field.model),
        },
      },
      {
        key: 'bitType',
        type: 'enum',
        defaultValue: 'end-mill',
        props: {
          label: 'bit type',
          required: true,
          options: [
            { value: 'end-mill', label: 'end mill' },
            { value: 'v-bit', label: 'v-bit' },
          ],
        },
      },
      {
        key: 'diameter',
        type: 'number',
        defaultValue: 3,
        props: {
          label: 'diameter',
          required: true,
        },
      },
      {
        key: 'vAngle',
        type: 'number',
        defaultValue: 60,
        props: {
          min: 1,
          max: 179,
          label: 'v angle',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      {
        key: 'tipDiameter',
        type: 'number',
        defaultValue: 0,
        props: {
          min: 0,
          label: 'tip diameter',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      toolFeedsAndSpeeds,
    ],
  },
};
