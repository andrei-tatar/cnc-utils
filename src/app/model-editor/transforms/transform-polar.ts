import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Copies of the shape spaced around a centre: a bolt circle, spokes, a
 * rosette.
 */
export interface ModelType {
  type: 'polar';
  polarCount: number;
  /** The angle the copies are spread over; 360 spaces them evenly round. */
  polarAngle: number;
  polarAround: 'point' | 'shape-center';
  polarX: number;
  polarY: number;
  /** Turn each copy with its position (else only move it). */
  polarRotate: boolean;
}

const hideUnlessPolar = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'polarCount',
      type: 'number',
      defaultValue: 6,
      props: { label: 'count', min: 1, required: true },
      validators: { validation: ['whole-number'] },
    },
    {
      key: 'polarAngle',
      type: 'number',
      defaultValue: 360,
      props: {
        label: 'angle',
        description:
          '° the copies are spread over, counter-clockwise; 360 spaces them evenly round',
        required: true,
      },
    },
    {
      key: 'polarAround',
      type: 'enum',
      defaultValue: 'point',
      props: {
        label: 'around',
        required: true,
        options: [
          { value: 'point', label: 'a point' },
          { value: 'shape-center', label: 'the shape’s centre' },
        ],
      },
    },
    {
      key: 'polarX',
      type: 'number',
      defaultValue: 0,
      props: { label: 'centre x', required: true },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessPolar(field) || field.model?.polarAround !== 'point',
      },
    },
    {
      key: 'polarY',
      type: 'number',
      defaultValue: 0,
      props: { label: 'centre y', required: true },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessPolar(field) || field.model?.polarAround !== 'point',
      },
    },
    {
      key: 'polarRotate',
      type: 'boolean',
      defaultValue: true,
      props: { label: 'turn each copy (else only move it)' },
    },
  ],
  expressions: { hide: hideUnlessPolar },
};

export const Definition = {
  type: 'polar',
  label: 'polar array',
  fieldGroup: field,
} as const;
