import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'rectangle';
  width: number;
  height: number;
  radius: number;
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
    {
      key: 'height',
      type: 'number',
      defaultValue: 25,
      props: {
        min: 0,
        label: 'height',
        required: true,
      },
    },
    {
      key: 'radius',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'radius',
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
  type: 'rectangle',
  label: 'rectangle',
  fieldGroup: field,
} as const;
