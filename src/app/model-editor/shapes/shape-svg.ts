import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'svg';
  svg: string;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'svg',
      type: 'file',
      props: {
        min: 0,
        label: 'open file',
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
  type: 'svg',
  label: 'svg',
  fieldGroup: field,
} as const;
