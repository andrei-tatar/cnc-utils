import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Mark the centre of each polygon: with a circle, or (radius 0) a single
 * point, e.g. for drilling.
 */
export interface ModelType {
  type: 'centers';
  /** 0 marks the centre with a point. */
  centersRadius: number;
  /** Mark holes too, or only outlines. */
  centersOf: 'outlines' | 'all';
  /** Keep the shape itself, adding the marks. */
  centersKeepOriginal: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'centersRadius',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'radius',
        description: 'mm; 0 marks each centre with a point (for drilling)',
        min: 0,
        required: true,
      },
    },
    {
      key: 'centersOf',
      type: 'enum',
      defaultValue: 'outlines',
      props: {
        label: 'centres of',
        required: true,
        options: [
          { value: 'outlines', label: 'each outline (not holes)' },
          { value: 'all', label: 'every polygon, holes too' },
        ],
      },
    },
    {
      key: 'centersKeepOriginal',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'keep the shape itself too' },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'centers',
  label: 'centre marks',
  fieldGroup: field,
} as const;
