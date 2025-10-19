import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'flat';
  depth: number;
  steps: number;
  toolEngagement: number;
  interpolateStepSize: boolean;
  allPassesInSameDirection: boolean;
  alongAxis: 'x' | 'y';
  growByToolsize: boolean;
  applyConvexHullOnShape: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'depth',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'depth',
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
    },
    {
      key: 'interpolateStepSize',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'interpolate step',
      },
    },
    {
      key: 'allPassesInSameDirection',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'all passes same dir.',
      },
    },
    {
      key: 'growByToolsize',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'grow by tool size',
      },
    },
    {
      key: 'applyConvexHullOnShape',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'apply convex hull',
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'flat',
  label: 'flat',
  fieldGroup: field,
} as const;
