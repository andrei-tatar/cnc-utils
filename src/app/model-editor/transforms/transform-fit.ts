import { FormlyFieldConfig } from '@ngx-formly/core';

/** Scale the shape to a given width and/or height. */
export interface ModelType {
  type: 'fit';
  /** Wanted width in mm; empty or 0 follows the height (or stays). */
  fitWidth: number | null;
  fitHeight: number | null;
  /** With both set: keep the proportions, fitting inside both. */
  fitKeepAspect: boolean;
  /** The point of the bounding box that stays put. */
  fitAround: `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}`;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'fitWidth',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'width',
        description: 'mm; empty scales by the height',
        min: 0,
      },
    },
    {
      key: 'fitHeight',
      type: 'number',
      props: {
        label: 'height',
        description: 'mm; empty scales by the width',
        min: 0,
      },
    },
    {
      key: 'fitKeepAspect',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'keep proportions (fit within both)',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          field.model?.type !== Definition.type ||
          !(field.model?.fitWidth > 0 && field.model?.fitHeight > 0),
      },
    },
    {
      key: 'fitAround',
      type: 'enum',
      defaultValue: 'xmin-ymin',
      props: {
        label: 'keep in place',
        required: true,
        options: [
          { value: 'xmin-ymin', label: 'bottom left' },
          { value: 'xcenter-ycenter', label: 'centre' },
          { value: 'xcenter-ymin', label: 'bottom middle' },
          { value: 'xmax-ymin', label: 'bottom right' },
          { value: 'xmin-ymax', label: 'top left' },
          { value: 'xcenter-ymax', label: 'top middle' },
          { value: 'xmax-ymax', label: 'top right' },
          { value: 'xmin-ycenter', label: 'left middle' },
          { value: 'xmax-ycenter', label: 'right middle' },
        ],
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'fit',
  label: 'scale to size',
  fieldGroup: field,
} as const;
