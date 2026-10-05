import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type?: 'profile';
  /** Which part of the shape to profile (see ShapePart). */
  mode?: 'both' | 'holes' | 'contours';
  startDepth: number;
  depth: number;
  steps: number;
  side: 'outside' | 'inside' | 'on-line';
  direction: 'climb' | 'conventional';
  tabsEnabled: boolean;
  tabCount: number;
  tabWidth: number;
  tabHeight: number;
  /** Ramp down into each pass along the toolpath instead of plunging. */
  ramp?: boolean;
  rampAngle?: number;
}

const hideUnlessProfile = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideUnlessTabs = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || !field.model?.tabsEnabled;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'mode',
      type: 'enum',
      defaultValue: 'both',
      props: {
        label: 'profile',
        required: true,
        options: [
          { value: 'both', label: 'outlines and holes' },
          { value: 'holes', label: 'holes only' },
          { value: 'contours', label: 'outlines only, holes ignored' },
        ],
      },
    },
    {
      key: 'side',
      type: 'enum',
      defaultValue: 'outside',
      props: {
        label: 'side',
        required: true,
        options: [
          { value: 'outside', label: 'outside' },
          { value: 'inside', label: 'inside' },
          { value: 'on-line', label: 'on line' },
        ],
      },
    },
    {
      key: 'direction',
      type: 'enum',
      defaultValue: 'climb',
      props: {
        label: 'direction',
        required: true,
        options: [
          { value: 'climb', label: 'climb' },
          { value: 'conventional', label: 'conventional' },
        ],
      },
    },
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'start depth',
        required: true,
      },
    },
    {
      key: 'depth',
      type: 'number',
      defaultValue: 5,
      props: {
        min: 0,
        label: 'depth/step',
        required: true,
      },
    },
    {
      key: 'steps',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'steps',
        required: true,
      },
    },
    {
      key: 'ramp',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'ramp in instead of plunging',
      },
    },
    {
      key: 'rampAngle',
      type: 'number',
      defaultValue: 3,
      props: {
        min: 0.5,
        max: 45,
        label: 'ramp angle',
        description:
          '° below horizontal; along the end of the loop (back and forth on open paths), over the tabs',
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          field.model?.type !== Definition.type || !field.model?.ramp,
      },
    },
    {
      key: 'tabsEnabled',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'tabs',
      },
    },
    {
      key: 'tabCount',
      type: 'number',
      defaultValue: 4,
      props: {
        min: 0,
        label: 'tab count',
        required: true,
      },
      expressions: { hide: hideUnlessTabs },
    },
    {
      key: 'tabWidth',
      type: 'number',
      defaultValue: 5,
      props: {
        min: 0,
        label: 'tab width',
        required: true,
      },
      expressions: { hide: hideUnlessTabs },
    },
    {
      key: 'tabHeight',
      type: 'number',
      defaultValue: 1.5,
      props: {
        min: 0,
        label: 'tab height',
        required: true,
      },
      expressions: { hide: hideUnlessTabs },
    },
  ],
  expressions: {
    hide: hideUnlessProfile,
  },
};

export const Definition = {
  type: 'profile',
  label: 'profile',
  fieldGroup: field,
} as const;
