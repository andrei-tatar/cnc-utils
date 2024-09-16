import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'rotate';
  rotateAngle: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'rotateAngle',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'angle',
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
  type: 'rotate',
  label: 'rotate',
  fieldGroup: field,
} as const;
