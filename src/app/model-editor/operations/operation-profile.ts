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
}

const hideUnlessProfile = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideUnlessOffset = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.side === 'on-line';

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
