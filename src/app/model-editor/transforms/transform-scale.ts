import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'scale';
  scaleX: number;
  scaleY: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'scaleX',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'x',
        required: true,
      },
    },
    {
      key: 'scaleY',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'y',
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
  type: 'scale',
  label: 'scale',
  fieldGroup: field,
} as const;
