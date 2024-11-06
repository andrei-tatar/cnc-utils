import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'flat';
  depth: number;
  toolEngagement: number;
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
  type: 'flat',
  label: 'flat',
  fieldGroup: field,
} as const;
