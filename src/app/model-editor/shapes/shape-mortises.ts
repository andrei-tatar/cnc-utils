import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Through mortises for a panel edge's tenons (a `box-panel` edge set to
 * tenons): laid out the same along X from 0 to the edge's length, centred
 * on Y = 0, each the tenon's width by the material's thickness, the play
 * bigger both ways. Place it where the other panel meets this one.
 */
export interface ModelType {
  type: 'mortises';
  /** The tenon edge's length (mm). */
  mortiseLength: number;
  /** The tenon panel's thickness, measured (mm). */
  mortiseThickness: number;
  mortiseCount: number;
  mortiseWidth: number;
  mortiseMargin: number;
  /** How much bigger a mortise is than its tenon (mm). */
  mortisePlay: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'mortiseLength',
      type: 'number',
      defaultValue: 120,
      props: {
        label: 'edge length',
        description: 'mm: the tenon edge’s, as on the other panel',
        min: 0,
        required: true,
      },
    },
    {
      key: 'mortiseThickness',
      type: 'number',
      defaultValue: 6,
      props: {
        label: 'material',
        description: 'mm thick: measure the tenon panel',
        min: 0,
        required: true,
      },
    },
    {
      key: 'mortiseCount',
      type: 'number',
      defaultValue: 2,
      props: { label: 'mortises', min: 1, required: true },
      validators: { validation: ['whole-number'] },
    },
    {
      key: 'mortiseWidth',
      type: 'number',
      defaultValue: 20,
      props: { label: 'tenon width', min: 0.1, required: true },
    },
    {
      key: 'mortiseMargin',
      type: 'number',
      defaultValue: 15,
      props: {
        label: 'in from the ends',
        description: 'mm; the rest evenly between, as the tenons are',
        min: 0,
        required: true,
      },
    },
    {
      key: 'mortisePlay',
      type: 'number',
      defaultValue: 0.2,
      props: {
        label: 'play',
        description: 'mm bigger than the tenon, both ways',
        min: 0,
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'mortises',
  label: 'mortises (for a panel’s tenons)',
  fieldGroup: field,
} as const;
