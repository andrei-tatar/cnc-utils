import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'pocket';
  startDepth: number;
  depth: number;
  steps: number;
  leaveStock: number;
  toolEngagement: number;
  strategy?: 'offset' | 'raster';
  alongAxis?: 'x' | 'y';
  allPassesInSameDirection?: boolean;
}

const hideUnlessRaster = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.strategy !== 'raster';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'strategy',
      type: 'enum',
      defaultValue: 'offset',
      props: {
        label: 'strategy',
        required: true,
        options: [
          { value: 'offset', label: 'offset' },
          { value: 'raster', label: 'raster' },
        ],
      },
    },
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
      key: 'depth',
      type: 'number',
      defaultValue: 5,
      props: {
        min: 0,
        label: 'depth/step',
        required: true,
      },
    },
    {
      key: 'steps',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'steps',
        required: true,
      },
    },
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'leave stock',
        required: true,
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.4,
      props: {
        min: 0,
        label: 'engagement',
        required: true,
      },
    },
    {
      key: 'alongAxis',
      type: 'enum',
      defaultValue: 'y',
      props: {
        label: 'along axis',
        required: true,
        options: [
          { value: 'x', label: 'x' },
          { value: 'y', label: 'y' },
        ],
      },
      expressions: { hide: hideUnlessRaster },
    },
    {
      key: 'allPassesInSameDirection',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'all passes same dir.',
      },
      expressions: { hide: hideUnlessRaster },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'pocket',
  label: 'pocket',
  fieldGroup: field,
} as const;
