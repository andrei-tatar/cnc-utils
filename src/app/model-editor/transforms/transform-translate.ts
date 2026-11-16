import { FormlyFieldConfig } from '@ngx-formly/core';
import { ofModelShape } from '../shapes/shape-model';

export interface ModelType {
  type: 'translate';
  translateX: number;
  translateY: number;
  /** A 3D model shape's only. */
  translateZ?: number;
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
    {
      key: 'translateZ',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'z',
        description: 'up; below the top of the stock is negative',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !ofModelShape(field),
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
