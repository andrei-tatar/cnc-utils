import { FormlyFieldConfig } from '@ngx-formly/core';
import { ofModelShape } from '../shapes/shape-model';

export interface ModelType {
  type: 'rotate';
  rotateAngle: number;
  /** A point of the bounding box, or `point` for (aroundX, aroundY). */
  around:
    `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}` | 'point';
  aroundX?: number;
  aroundY?: number;
  /**
   * A 3D model shape's only: the axis it turns round (Z, like a flat
   * shape, when left out) and the point's height.
   */
  rotateAxis?: 'x' | 'y' | 'z';
  aroundZ?: number;
}

const hideUnlessPoint = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.around !== 'point';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'rotateAngle',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'angle',
        required: true,
      },
    },
    {
      key: 'rotateAxis',
      type: 'enum',
      defaultValue: 'z',
      props: {
        label: 'round',
        description:
          'Z turns it like a flat shape; X and Y by the right-hand rule, as a rotary axis along them turns the stock',
        required: true,
        options: [
          { value: 'z', label: 'the Z axis (flat)' },
          { value: 'x', label: 'the X axis' },
          { value: 'y', label: 'the Y axis' },
        ],
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !ofModelShape(field),
      },
    },
    {
      key: 'around',
      type: 'enum',
      defaultValue: 'xcenter-ycenter',
      props: {
        label: 'around',
        required: true,
        options: [
          { value: 'xcenter-ycenter', label: 'center' },
          { value: 'xmin-ymin', label: 'xmin ymin' },
          { value: 'xmax-ymin', label: 'xmax ymin' },
          { value: 'xcenter-ymin', label: 'xcenter ymin' },
          { value: 'xmin-ymax', label: 'xmin ymax' },
          { value: 'xmax-ymax', label: 'xmax ymax' },
          { value: 'xcenter-ymax', label: 'xcenter ymax' },
          { value: 'xmin-ycenter', label: 'xmin ycenter' },
          { value: 'xmax-ycenter', label: 'xmax ycenter' },
          { value: 'point', label: 'a point' },
        ],
      },
    },
    {
      key: 'aroundX',
      type: 'number',
      defaultValue: 0,
      props: { label: 'x', required: true },
      expressions: { hide: hideUnlessPoint },
    },
    {
      key: 'aroundY',
      type: 'number',
      defaultValue: 0,
      props: { label: 'y', required: true },
      expressions: { hide: hideUnlessPoint },
    },
    {
      key: 'aroundZ',
      type: 'number',
      defaultValue: 0,
      props: { label: 'z', required: true },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessPoint(field) || !ofModelShape(field),
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
  type: 'rotate',
  label: 'rotate',
  fieldGroup: field,
} as const;
