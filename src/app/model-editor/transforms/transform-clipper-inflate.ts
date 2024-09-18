import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'clipper-inflate';
  offset: number;
  joinType: 'square' | 'round' | 'miter';
  endType: 'polygon' | 'joined' | 'butt' | 'square' | 'round';
  precision: number;
  miterLimit: number;
  arcTolerance: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'offset',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'offset',
        required: true,
      },
    },
    {
      key: 'joinType',
      type: 'enum',
      defaultValue: 'round',
      props: {
        options: [
          {
            value: 'square',
            label: 'square',
          },
          {
            value: 'round',
            label: 'round',
          },
          {
            value: 'miter',
            label: 'miter',
          },
        ],
        label: 'join',
        required: true,
      },
    },
    {
      key: 'endType',
      type: 'enum',
      defaultValue: 'polygon',
      props: {
        options: [
          {
            value: 'polygon',
            label: 'polygon',
          },
          {
            value: 'joined',
            label: 'joined',
          },
          {
            value: 'butt',
            label: 'butt',
          },
          {
            value: 'square',
            label: 'square',
          },
          {
            value: 'round',
            label: 'round',
          },
        ],
        label: 'end',
        required: true,
      },
    },
    {
      key: 'precision',
      type: 'number',
      defaultValue: 0.05,
      props: {
        label: 'precision',
        required: true,
      },
    },
    {
      key: 'miterLimit',
      type: 'number',
      defaultValue: 2,
      props: {
        label: 'miter limit',
        required: true,
      },
    },
    {
      key: 'arcTolerance',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'arc tolerance',
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
  type: 'clipper-inflate',
  label: 'clipper:inflate',
  fieldGroup: field,
} as const;
