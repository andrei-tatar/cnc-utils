import { FormlyFieldConfig } from '@ngx-formly/core';
import { ofModelShape } from '../shapes/shape-model';

export interface ModelType {
  type: 'scale';
  scaleX: number;
  scaleY: number;
  /** A 3D model shape's only. */
  scaleZ?: number;
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
    {
      key: 'scaleZ',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'z',
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
  type: 'scale',
  label: 'scale',
  fieldGroup: field,
} as const;
