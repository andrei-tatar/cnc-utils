import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'pocket';
  startDepth: number;
  depth: number;
  steps: number;
  leaveStock: number;
  toolEngagement: number;
  /** Ramp down into each pass along the toolpath instead of plunging. */
  ramp?: boolean;
  rampAngle?: number;
}

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
      key: 'ramp',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'ramp in instead of plunging',
      },
    },
    {
      key: 'rampAngle',
      type: 'number',
      defaultValue: 3,
      props: {
        min: 0.5,
        max: 45,
        label: 'ramp angle',
        description:
          '° below horizontal; goes round each loop down to the next depth',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          field.model?.type !== Definition.type || !field.model?.ramp,
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
  type: 'pocket',
  label: 'pocket',
  fieldGroup: field,
} as const;
