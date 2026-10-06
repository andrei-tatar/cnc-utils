import { FormlyFieldConfig } from '@ngx-formly/core';

/** A bevel (edge break) along the shape's edges, with a V-bit. */
export interface ModelType {
  type?: 'chamfer';
  /** Width of the bevel across the top (mm). */
  chamferWidth: number;
  chamferEdges: 'part' | 'hole';
  /** How far below the bevel the tip runs (mm). */
  extraDepth: number;
  passes: number;
  direction: 'climb' | 'conventional';
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'chamferEdges',
      type: 'enum',
      defaultValue: 'part',
      props: {
        label: 'the shape is',
        required: true,
        options: [
          { value: 'part', label: 'a part: bevel its outline and holes' },
          { value: 'hole', label: 'a hole or pocket: bevel its rim' },
        ],
      },
    },
    {
      key: 'chamferWidth',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'width',
        description: 'mm across the top',
        min: 0,
        required: true,
      },
    },
    {
      key: 'extraDepth',
      type: 'number',
      defaultValue: 0.2,
      props: {
        label: 'tip below',
        description: 'mm the tip runs below the bevel, so no step is left',
        min: 0,
        required: true,
      },
    },
    {
      key: 'passes',
      type: 'number',
      defaultValue: 1,
      props: { label: 'passes', min: 1, required: true },
      validators: { validation: ['whole-number'] },
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
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'chamfer',
  label: 'chamfer',
  fieldGroup: field,
} as const;
