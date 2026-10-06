import { FormlyFieldConfig } from '@ngx-formly/core';

/** Outlines traced from an image (a logo, a scan, a drawing). */
export interface ModelType {
  type: 'trace';
  /** The image, as a data URL. */
  image: string;
  /** Name of the file it was loaded from (display only). */
  fileName?: string;
  /** 0–255: pixels darker than this are traced. */
  traceThreshold: number;
  /** Trace the light areas instead. */
  traceInvert: boolean;
  /** Width of the result in mm; the height follows the image. */
  traceWidth: number;
  /** Drop outlines enclosing less than this, in mm². */
  traceMinArea: number;
  /** How far outlines may move to smooth them, in mm. */
  traceSmoothing: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    { key: 'fileName', type: 'hidden' },
    {
      key: 'image',
      type: 'file',
      props: {
        label: 'image',
        accept: 'image/*',
        readAs: 'dataUrl',
        fileNameKey: 'fileName',
        required: true,
      },
    },
    {
      key: 'traceThreshold',
      type: 'number',
      defaultValue: 128,
      props: {
        label: 'threshold',
        description: '0–255: pixels darker than this are traced',
        min: 0,
        max: 255,
        required: true,
      },
    },
    {
      key: 'traceInvert',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'trace the light areas instead' },
    },
    {
      key: 'traceWidth',
      type: 'number',
      defaultValue: 100,
      props: {
        label: 'width',
        description: 'mm; the height follows the image',
        min: 0,
        required: true,
      },
    },
    {
      key: 'traceMinArea',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'ignore specks under',
        description: 'mm²',
        min: 0,
        required: true,
      },
    },
    {
      key: 'traceSmoothing',
      type: 'number',
      defaultValue: 0.05,
      props: {
        label: 'smoothing',
        description: 'mm outlines may move to lose points',
        min: 0,
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'trace',
  label: 'image trace',
  fieldGroup: field,
} as const;
