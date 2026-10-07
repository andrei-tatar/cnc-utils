import { FormlyFieldConfig } from '@ngx-formly/core';
import { DepthSteps, depthStepsFields } from './depth-steps';

export interface ModelType extends DepthSteps {
  type?: 'flat';
  toolEngagement: number;
  interpolateStepSize: boolean;
  allPassesInSameDirection: boolean;
  alongAxis: 'x' | 'y';
  growByToolsize: boolean;
  applyConvexHullOnShape: boolean;
  pauseAfterEachStep: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    ...depthStepsFields({ depth: 0 }),
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
    {
      key: 'pauseAfterEachStep',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'pause after each step',
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
