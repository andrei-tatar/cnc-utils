import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'circle';
  diameter: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'diameter',
      type: 'number',
      defaultValue: 50,
      props: {
        min: 0,
        label: 'diameter',
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
  type: 'circle',
  label: 'circle',
  fieldGroup: field,
} as const;
