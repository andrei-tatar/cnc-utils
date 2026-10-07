import { FormlyFieldConfig } from '@ngx-formly/core';
import { DepthSteps, depthStepsFields } from './depth-steps';

export interface ModelType extends DepthSteps {
  type?: 'profile';
  /** Which part of the shape to profile (see ShapePart). */
  mode?: 'both' | 'holes' | 'contours';
  side: 'outside' | 'inside' | 'on-line';
  direction: 'climb' | 'conventional';
  /** Material left on the wall for a finishing pass (mm); not on line. */
  leaveStock?: number;
  tabsEnabled: boolean;
  tabCount: number;
  tabWidth: number;
  tabHeight: number;
  /** Moves all tabs this far along the toolpath (mm). */
  tabOffset?: number;
}

const hideUnlessProfile = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideUnlessOffset = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.side === 'on-line';

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
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'leave stock',
        required: true,
      },
      expressions: { hide: hideUnlessOffset },
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
    ...depthStepsFields(),
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
    {
      key: 'tabOffset',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'tab offset',
        description: 'mm along the toolpath; moves all the tabs',
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
