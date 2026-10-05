import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Move the shape so a side or the middle of its bounding box lands on a
 * coordinate, along X, Y or both. Y points up: top is the largest Y.
 */
export interface ModelType {
  type: 'align';
  alignX: 'none' | 'left' | 'middle' | 'right';
  alignXTo: number;
  alignY: 'none' | 'top' | 'middle' | 'bottom';
  alignYTo: number;
}

const hideUnlessAlign = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'alignX',
      type: 'enum',
      defaultValue: 'left',
      props: {
        label: 'align x',
        required: true,
        options: [
          { value: 'none', label: 'don’t align x' },
          { value: 'left', label: 'left' },
          { value: 'middle', label: 'middle' },
          { value: 'right', label: 'right' },
        ],
      },
    },
    {
      key: 'alignXTo',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'to x',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessAlign(field) || field.model?.alignX === 'none',
      },
    },
    {
      key: 'alignY',
      type: 'enum',
      defaultValue: 'bottom',
      props: {
        label: 'align y',
        required: true,
        options: [
          { value: 'none', label: 'don’t align y' },
          { value: 'top', label: 'top' },
          { value: 'middle', label: 'middle' },
          { value: 'bottom', label: 'bottom' },
        ],
      },
    },
    {
      key: 'alignYTo',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'to y',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessAlign(field) || field.model?.alignY === 'none',
      },
    },
  ],
  expressions: {
    hide: hideUnlessAlign,
  },
};

export const Definition = {
  type: 'align',
  label: 'align',
  fieldGroup: field,
} as const;
