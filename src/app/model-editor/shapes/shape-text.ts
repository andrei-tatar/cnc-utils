import { FormlyFieldConfig } from '@ngx-formly/core';
import { DEFAULT_FONT, FontRef } from '../../../cam/font-source';

export interface ModelType {
  type: 'text';
  text: string;
  font: FontRef;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  /** Height of capital letters, in mm. */
  size: number;
  letterSpacing: number;
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
}

const hideUnlessText = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'text',
      type: 'textarea',
      defaultValue: 'Hello',
      props: {
        label: 'text',
        rows: 3,
        required: true,
      },
    },
    {
      key: 'font',
      type: 'font',
      defaultValue: DEFAULT_FONT,
      props: {
        label: 'font',
        required: true,
      },
    },
    {
      key: 'fontWeight',
      type: 'enum',
      defaultValue: 400,
      props: {
        label: 'weight',
        required: true,
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) =>
          ((field.model?.font as FontRef | undefined)?.weights ?? [400]).map(
            (weight) => ({ value: weight, label: weightLabel(weight) }),
          ),
      },
    },
    {
      key: 'fontStyle',
      type: 'enum',
      defaultValue: 'normal',
      props: {
        label: 'style',
        required: true,
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) =>
          ((field.model?.font as FontRef | undefined)?.styles ?? ['normal'])
            .slice()
            .sort((a) => (a === 'normal' ? -1 : 1))
            .map((style) => ({ value: style, label: style })),
      },
    },
    {
      key: 'size',
      type: 'number',
      defaultValue: 20,
      props: {
        min: 0,
        label: 'cap height',
        description: 'height of capital letters, in mm',
        required: true,
      },
    },
    {
      key: 'letterSpacing',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'letter spacing',
        required: true,
      },
    },
    {
      key: 'lineSpacing',
      type: 'number',
      defaultValue: 1.2,
      props: {
        min: 0,
        label: 'line spacing',
        required: true,
      },
    },
    {
      key: 'align',
      type: 'enum',
      defaultValue: 'left',
      props: {
        label: 'align',
        required: true,
        options: [
          { value: 'left', label: 'left' },
          { value: 'center', label: 'center' },
          { value: 'right', label: 'right' },
        ],
      },
    },
  ],
  expressions: {
    hide: hideUnlessText,
  },
};

const WEIGHT_NAMES: Record<number, string> = {
  100: 'thin',
  200: 'extra light',
  300: 'light',
  400: 'regular',
  500: 'medium',
  600: 'semi bold',
  700: 'bold',
  800: 'extra bold',
  900: 'black',
};

function weightLabel(weight: number) {
  return WEIGHT_NAMES[weight]
    ? `${weight} · ${WEIGHT_NAMES[weight]}`
    : `${weight}`;
}

export const Definition = {
  type: 'text',
  label: 'text',
  fieldGroup: field,
} as const;
