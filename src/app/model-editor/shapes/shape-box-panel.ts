import { FormlyFieldConfig } from '@ngx-formly/core';
import { EdgeJoint } from '../../../cam/box-joints';

/**
 * A box side with finger joints on any of its edges. Edges that meet on the
 * box need the same length and finger width, one with tabs and the other
 * with slots.
 */
export interface ModelType {
  type: 'box-panel';
  boxWidth: number;
  boxHeight: number;
  boxThickness: number;
  boxFingerWidth: number;
  boxPlay: number;
  boxBottom: EdgeJoint;
  boxRight: EdgeJoint;
  boxTop: EdgeJoint;
  boxLeft: EdgeJoint;
}

const edgeOptions = [
  { value: 'flat', label: 'flat' },
  { value: 'tabs', label: 'fingers, tab at each end' },
  { value: 'slots', label: 'fingers, slot at each end' },
];

const edge = (key: string, label: string, value: EdgeJoint) => ({
  key,
  type: 'enum',
  defaultValue: value,
  props: { label, required: true, options: edgeOptions },
});

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'boxWidth',
      type: 'number',
      defaultValue: 120,
      props: {
        label: 'width',
        description: 'mm, outer, fingers included',
        min: 0,
        required: true,
      },
    },
    {
      key: 'boxHeight',
      type: 'number',
      defaultValue: 80,
      props: { label: 'height', min: 0, required: true },
    },
    {
      key: 'boxThickness',
      type: 'number',
      defaultValue: 6,
      props: {
        label: 'material',
        description: 'mm thick: the depth of the slots',
        min: 0,
        required: true,
      },
    },
    {
      key: 'boxFingerWidth',
      type: 'number',
      defaultValue: 12,
      props: {
        label: 'finger width',
        description:
          'mm, roughly: each edge gets an odd number of equal fingers',
        min: 0.1,
        required: true,
      },
    },
    {
      key: 'boxPlay',
      type: 'number',
      defaultValue: 0.1,
      props: {
        label: 'play',
        description: 'mm a finger is narrower than its slot',
        min: 0,
        required: true,
      },
    },
    edge('boxBottom', 'bottom edge', 'tabs'),
    edge('boxRight', 'right edge', 'slots'),
    edge('boxTop', 'top edge', 'tabs'),
    edge('boxLeft', 'left edge', 'slots'),
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'box-panel',
  label: 'box panel (finger joints)',
  fieldGroup: field,
} as const;
