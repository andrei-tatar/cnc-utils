import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'translate';
  translateX: number;
  translateY: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'translateX',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'x',
        required: true,
      },
    },
    {
      key: 'translateY',
      type: 'number',
      defaultValue: 0,
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
  type: 'translate',
  label: 'move',
  fieldGroup: field,
} as const;
