import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'line';
  width: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'width',
      type: 'number',
      defaultValue: 50,
      props: {
        min: 0,
        label: 'width',
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
  type: 'line',
  label: 'line',
  fieldGroup: field,
} as const;
