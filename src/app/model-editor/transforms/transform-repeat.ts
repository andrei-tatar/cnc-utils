import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'repeat';
  repeatCountX: number;
  repeatCountY: number;
  repeatSpaceX: number;
  repeatSpaceY: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'repeatCountX',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'count x',
        required: true,
      },
      validators: {
        validation: ['whole-number'],
      },
    },
    {
      key: 'repeatCountY',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'count y',
        required: true,
      },
      validators: {
        validation: ['whole-number'],
      },
    },
    {
      key: 'repeatSpaceX',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'space x',
        required: true,
      },
    },
    {
      key: 'repeatSpaceY',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'space y',
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
