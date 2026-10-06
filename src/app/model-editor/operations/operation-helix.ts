import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Bore round holes by spiralling down round them: holes bigger than the
 * tool without plunging, and holes of any size from one tool.
 */
export interface ModelType {
  type?: 'helix';
  startDepth: number;
  depth: number;
  /** Depth per turn of the helix. */
  pitch: number;
  direction: 'climb' | 'conventional';
  leaveStock: number;
  clearMiddle: boolean;
  toolEngagement: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: { label: 'start depth', required: true },
    },
    {
      key: 'depth',
      type: 'number',
      defaultValue: 5,
      props: { label: 'depth', min: 0, required: true },
    },
    {
      key: 'pitch',
      type: 'number',
      defaultValue: 0.5,
      props: {
        label: 'depth per turn',
        description: 'mm the tool goes down each time round',
        min: 0.01,
        required: true,
      },
    },
    {
      key: 'direction',
      type: 'enum',
      defaultValue: 'climb',
      props: {
        label: 'direction',
        required: true,
        options: [
          { value: 'climb', label: 'climb' },
          { value: 'conventional', label: 'conventional' },
        ],
      },
    },
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0,
      props: { label: 'leave stock', min: 0, required: true },
    },
    {
      key: 'clearMiddle',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'clear the middle of wide holes (else a core is left)',
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.4,
      props: {
        label: 'engagement',
        description: 'ring spacing, as a fraction of the tool diameter',
        min: 0.05,
        max: 1,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          field.model?.type !== Definition.type || !field.model?.clearMiddle,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'helix',
  label: 'helical bore',
  fieldGroup: field,
} as const;
