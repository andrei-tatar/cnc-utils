import { FormlyFieldConfig } from '@ngx-formly/core';
import { EdgeJoint } from '../../../cam/box-joints';

/**
 * A box side (or any panel) with joints on any of its edges: finger joints
 * (edges that meet need the same length and finger width, one with tabs
 * and the other with slots), tenons that go through mortises in the other
 * panel (a `mortises` shape laid out the same), or dovetails in the panel's
 * plane, joining it edge to edge with another (tails on one, sockets on
 * the other, both the same length and count).
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
  /** Tenon edges: how many tenons, how wide, how far in from the ends. */
  boxTenonCount?: number;
  boxTenonWidth?: number;
  boxTenonMargin?: number;
  /** Dovetail edges: how many, and how far their sides lean (degrees). */
  boxDovetailCount?: number;
  boxDovetailAngle?: number;
}

const edgeOptions = [
  { value: 'flat', label: 'flat' },
  { value: 'tabs', label: 'fingers, tab at each end' },
  { value: 'slots', label: 'fingers, slot at each end' },
  { value: 'tenons', label: 'tenons (through mortises in the other panel)' },
  { value: 'tails', label: 'dovetail tails (edge to edge)' },
  { value: 'sockets', label: 'dovetail sockets (for tails)' },
];

/** Whether any edge of the panel is one of `joints`. */
const usesAny =
  (...joints: EdgeJoint[]) =>
  (field: FormlyFieldConfig) =>
    ['boxBottom', 'boxRight', 'boxTop', 'boxLeft'].some((key) =>
      joints.includes(field.model?.[key]),
    );
const hideUnless = (...joints: EdgeJoint[]) => ({
  hide: (field: FormlyFieldConfig) => !usesAny(...joints)(field),
});

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
        description:
          'mm thick (measure it): how deep slots go and tenons stand out; how long dovetails are',
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
    {
      key: 'boxTenonCount',
      type: 'number',
      defaultValue: 2,
      props: {
        label: 'tenons',
        description: 'on each tenon edge',
        min: 1,
        required: true,
      },
      validators: { validation: ['whole-number'] },
      expressions: hideUnless('tenons'),
    },
    {
      key: 'boxTenonWidth',
      type: 'number',
      defaultValue: 20,
      props: { label: 'tenon width', min: 0.1, required: true },
      expressions: hideUnless('tenons'),
    },
    {
      key: 'boxTenonMargin',
      type: 'number',
      defaultValue: 15,
      props: {
        label: 'tenons in from the ends',
        description: 'mm; the rest evenly between',
        min: 0,
        required: true,
      },
      expressions: hideUnless('tenons'),
    },
    {
      key: 'boxDovetailCount',
      type: 'number',
      defaultValue: 3,
      props: {
        label: 'dovetails',
        description: 'on each dovetail edge',
        min: 1,
        required: true,
      },
      validators: { validation: ['whole-number'] },
      expressions: hideUnless('tails', 'sockets'),
    },
    {
      key: 'boxDovetailAngle',
      type: 'number',
      defaultValue: 10,
      props: {
        label: 'dovetail angle',
        description: 'degrees their sides lean (1:6 is 9.5)',
        min: 1,
        max: 30,
        required: true,
      },
      expressions: hideUnless('tails', 'sockets'),
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'box-panel',
  label: 'panel with joints (fingers, tenons, dovetails)',
  fieldGroup: field,
} as const;
