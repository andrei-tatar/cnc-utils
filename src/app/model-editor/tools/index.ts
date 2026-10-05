import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';

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
  feedRate: number;
  plungeFeedRate: number;
  /** Optional; overrides the G-code section's spindle speed. */
  spindleSpeed?: number | null;
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
      {
        key: 'feedRate',
        type: 'number',
        defaultValue: 1200,
        props: {
          label: 'feed rate',
          required: true,
        },
      },
      {
        key: 'plungeFeedRate',
        type: 'number',
        defaultValue: 300,
        props: {
          label: 'plunge fr',
          required: true,
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
  },
};
