import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'pocket';
  depth: number;
  steps: number;
  leaveStock: number;
  toolEngagement: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
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
