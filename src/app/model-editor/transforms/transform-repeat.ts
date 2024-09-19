import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'repeat';
  repeatCountX: number;
  repeatCountY: number;
  repeatSpaceX: number;
  repeatSpaceY: number;
  repeatTypeX: 'each' | 'within';
  repeatTypeY: 'each' | 'within';
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'repeatCountX',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'x count',
        required: true,
      },
      validators: {
        validation: ['whole-number'],
      },
    },
    {
      key: 'repeatTypeX',
      type: 'enum',
      defaultValue: 'each',
      props: {
        label: 'x type',
        required: true,
        options: [
          { value: 'each', label: 'each' },
          { value: 'within', label: 'within' },
        ],
      },
    },
    {
      key: 'repeatSpaceX',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'x space',
        required: true,
      },
    },
    {
      key: 'repeatCountY',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'y count',
        required: true,
      },
      validators: {
        validation: ['whole-number'],
      },
    },
    {
      key: 'repeatTypeY',
      type: 'enum',
      defaultValue: 'each',
      props: {
        label: 'y type',
        required: true,
        options: [
          { value: 'each', label: 'each' },
          { value: 'within', label: 'within' },
        ],
      },
    },
    {
      key: 'repeatSpaceY',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'y space',
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
  type: 'repeat',
  label: 'repeat',
  fieldGroup: field,
} as const;
