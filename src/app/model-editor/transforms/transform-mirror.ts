import { FormlyFieldConfig } from '@ngx-formly/core';

/** Add a mirror image of the shape, across a vertical or horizontal line. */
export interface ModelType {
  type: 'mirror';
  /** `vertical` mirrors left–right, across a vertical line. */
  mirrorAxis: 'vertical' | 'horizontal';
  /** Where the line is: on a side of the shape, or at a coordinate. */
  mirrorAt: 'min' | 'max' | 'center' | 'value';
  mirrorValue: number;
  /** Keep the original next to its mirror image. */
  mirrorKeepOriginal: boolean;
}

const hideUnlessMirror = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'mirrorAxis',
      type: 'enum',
      defaultValue: 'vertical',
      props: {
        label: 'mirror',
        required: true,
        options: [
          { value: 'vertical', label: 'left–right (vertical line)' },
          { value: 'horizontal', label: 'up–down (horizontal line)' },
        ],
      },
    },
    {
      key: 'mirrorAt',
      type: 'enum',
      defaultValue: 'max',
      props: {
        label: 'line at',
        required: true,
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) =>
          field.model?.mirrorAxis === 'horizontal'
            ? horizontalOptions
            : verticalOptions,
      },
    },
    {
      key: 'mirrorValue',
      type: 'number',
      defaultValue: 0,
      props: { required: true },
      expressions: {
        'props.label': (field: FormlyFieldConfig) =>
          field.model?.mirrorAxis === 'horizontal' ? 'y' : 'x',
        hide: (field: FormlyFieldConfig) =>
          hideUnlessMirror(field) || field.model?.mirrorAt !== 'value',
      },
    },
    {
      key: 'mirrorKeepOriginal',
      type: 'boolean',
      defaultValue: true,
      props: { label: 'keep the original' },
    },
  ],
  expressions: { hide: hideUnlessMirror },
};

// Fixed lists: a new one on every check would keep rebuilding the select.
const verticalOptions = [
  { value: 'max', label: 'the shape’s right side' },
  { value: 'min', label: 'the shape’s left side' },
  { value: 'center', label: 'the shape’s middle' },
  { value: 'value', label: 'x =' },
];
const horizontalOptions = [
  { value: 'max', label: 'the shape’s top' },
  { value: 'min', label: 'the shape’s bottom' },
  { value: 'center', label: 'the shape’s middle' },
  { value: 'value', label: 'y =' },
];

export const Definition = {
  type: 'mirror',
  label: 'mirror copy',
  fieldGroup: field,
} as const;
