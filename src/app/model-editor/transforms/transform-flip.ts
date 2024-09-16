import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'flip';
  flipHorizontal: false;
  flipVertical: false;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'flipHorizontal',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'horizontal',
      },
    },
    {
      key: 'flipVertical',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'vertical',
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
  type: 'flip',
  label: 'flip',
  fieldGroup: field,
} as const;
