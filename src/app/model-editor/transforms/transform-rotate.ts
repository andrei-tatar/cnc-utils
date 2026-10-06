import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'rotate';
  rotateAngle: number;
  /** A point of the bounding box, or `point` for (aroundX, aroundY). */
  around:
    `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}` | 'point';
  aroundX?: number;
  aroundY?: number;
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
