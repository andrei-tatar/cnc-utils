import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'v-carve';
  startDepth: number;
  maxDepth: number;
  stepover: number;
  clearFlatBottom: boolean;
  sharpCorners: boolean;
  sharpCornerAngle: number;
}

const hideUnlessVCarve = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideUnlessSharpCorners = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || !field.model?.sharpCorners;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'start depth',
        required: true,
      },
    },
    {
      key: 'maxDepth',
      type: 'number',
      defaultValue: 3,
      props: {
        min: 0,
        label: 'max depth',
        required: true,
      },
    },
    {
      key: 'stepover',
      type: 'number',
      defaultValue: 0.1,
      props: {
        min: 0.01,
        label: 'stepover',
        required: true,
      },
    },
    {
      key: 'clearFlatBottom',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'clear flat bottom at max depth',
      },
    },
    {
      key: 'sharpCorners',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'sharp corners',
      },
    },
    {
      key: 'sharpCornerAngle',
      type: 'number',
      defaultValue: 150,
      props: {
        min: 1,
        max: 179,
        label: 'sharpen corners up to (deg)',
        required: true,
      },
      expressions: { hide: hideUnlessSharpCorners },
    },
  ],
  expressions: {
    hide: hideUnlessVCarve,
  },
};

export const Definition = {
  type: 'v-carve',
  label: 'v-carve',
  fieldGroup: field,
} as const;
