import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'path-data';
  data: string;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'data',
      type: 'input',
      defaultValue: 'M 0,0 L100,0 L100,100 L0,100 Z',
      props: {
        label: 'data',
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
  type: 'path-data',
  label: 'path data',
  fieldGroup: field,
} as const;
