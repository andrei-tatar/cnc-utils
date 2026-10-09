import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn } from '../variables/field';
import { allTools } from '../tools';

/**
 * A picture engraved with a V-bit: raster lines across the shape, each
 * carved as deep as the image is dark where it passes, so dark areas come
 * out as wide grooves and light ones as fine lines.
 */
export interface ModelType {
  type?: 'image-engrave';
  /** The image, as a data URL. */
  image: string;
  /** Name of the file it was loaded from (display only). */
  fileName?: string;
  /** How the image fills the shape's bounding box. */
  imageFit: 'contain' | 'cover' | 'stretch';
  /** Percent of the fitted size. */
  imageScale: number;
  /** Which side of the box the image keeps to. */
  imageAlignX: 'left' | 'center' | 'right';
  imageAlignY: 'bottom' | 'middle' | 'top';
  /** Moved this far from there (mm). */
  imageOffsetX: number;
  imageOffsetY: number;
  /** Turned clockwise first: 0, 90, 180 or 270 (degrees). */
  imageRotation?: number;
  /** Carve the light areas deepest instead (a negative). */
  invertImage: boolean;
  /** Depth for white (mm). */
  lightDepth: number;
  /** Depth for black (mm). */
  darkDepth: number;
  /** Depth follows darkness raised to this: above 1 lightens mid-tones. */
  gamma: number;
  /** Between raster lines (mm). */
  lineSpacing: number;
  /** Direction of the lines, degrees counter-clockwise from the X axis. */
  rasterAngle: number;
  /** Between samples of the image along a line (mm). */
  sampleStep: number;
  allPassesInSameDirection: boolean;
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
      wrappers: ['group'],
      props: {
        label: 'image placement',
        description:
          'on the shape’s bounding box; the shape’s outline clips it',
        collapsible: true,
        // Open when it's been moved off the default, so it isn't missed.
        startOpen: (model: any) =>
          (model?.imageScale ?? 100) !== 100 ||
          (model?.imageAlignX ?? 'center') !== 'center' ||
          (model?.imageAlignY ?? 'middle') !== 'middle' ||
          !!model?.imageOffsetX ||
          !!model?.imageOffsetY ||
          !!model?.imageRotation,
      },
      fieldGroup: [
        {
          key: 'imageRotation',
          type: 'enum',
          defaultValue: 0,
          props: {
            label: 'turned',
            required: true,
            options: [
              { value: 0, label: 'as it is' },
              { value: 90, label: '90° clockwise' },
              { value: 180, label: '180°' },
              { value: 270, label: '90° anticlockwise' },
            ],
          },
        },
        {
          key: 'imageFit',
          type: 'enum',
          defaultValue: 'contain',
          props: {
            label: 'fit',
            required: true,
            options: [
              { value: 'contain', label: 'whole image inside' },
              { value: 'cover', label: 'cover, cropping the image' },
              { value: 'stretch', label: 'stretch' },
            ],
          },
        },
        {
          key: 'imageScale',
          type: 'number',
          defaultValue: 100,
          props: {
            label: 'scale',
            description: '% of the fitted size',
            min: 0.1,
            required: true,
          },
        },
        {
          key: 'imageAlignX',
          type: 'enum',
          defaultValue: 'center',
          props: {
            label: 'align across',
            required: true,
            options: [
              { value: 'left', label: 'left' },
              { value: 'center', label: 'centre' },
              { value: 'right', label: 'right' },
            ],
          },
        },
        {
          key: 'imageAlignY',
          type: 'enum',
          defaultValue: 'middle',
          props: {
            label: 'align up',
            required: true,
            options: [
              { value: 'bottom', label: 'bottom' },
              { value: 'middle', label: 'middle' },
              { value: 'top', label: 'top' },
            ],
          },
        },
        {
          key: 'imageOffsetX',
          type: 'number',
          defaultValue: 0,
          props: {
            label: 'move X',
            description: 'mm',
            required: true,
          },
        },
        {
          key: 'imageOffsetY',
          type: 'number',
          defaultValue: 0,
          props: {
            label: 'move Y',
            description: 'mm',
            required: true,
          },
        },
      ],
    },
    {
      key: 'invertImage',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'carve the light areas deepest (negative)' },
    },
    {
      key: 'lightDepth',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'depth for white',
        description: 'mm; 0 leaves white areas uncut',
        min: 0,
        required: true,
      },
    },
    {
      key: 'darkDepth',
      type: 'number',
      defaultValue: 0.4,
      props: {
        label: 'depth for black',
        min: 0,
        required: true,
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) => darkDepthHint(field),
      },
    },
    {
      key: 'gamma',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'gamma',
        description:
          '1: groove width follows darkness; above 1 lightens the mid-tones, below darkens them',
        min: 0.1,
        required: true,
      },
    },
    {
      key: 'lineSpacing',
      type: 'number',
      defaultValue: 0.5,
      props: {
        label: 'line spacing',
        description: 'mm between raster lines',
        min: 0.01,
        required: true,
      },
    },
    {
      key: 'rasterAngle',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'line angle',
        description: 'degrees from the X axis',
        required: true,
      },
    },
    {
      key: 'sampleStep',
      type: 'number',
      defaultValue: 0.1,
      props: {
        label: 'resolution',
        description: 'mm between depth changes along a line',
        min: 0.01,
        required: true,
      },
    },
    {
      key: 'allPassesInSameDirection',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'all lines in the same direction',
        description: 'slower, but every groove is cut alike',
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'image-engrave',
  label: 'image engraving (raster)',
  fieldGroup: field,
} as const;

/**
 * How wide the V-bit's groove is at the depth for black, against the line
 * spacing: grooves as wide as the spacing just meet (the darkest the
 * engraving gets); deeper, they cut the ridges between them away.
 */
function darkDepthHint(field: FormlyFieldConfig): string {
  const op = field.model;
  const tool = allTools(field).find((t) => t.id === op?.toolId);
  if (tool?.bitType !== 'v-bit' || !tool.vAngle || !tool.diameter) {
    return 'mm';
  }
  const tan = Math.tan(((tool.vAngle / 2) * Math.PI) / 180);
  const tip = tool.tipDiameter ?? 0;
  const cone = Math.max(0, tool.diameter - tip) / 2 / tan;
  const depth = numberIn(field, op?.darkDepth) ?? 0;
  const spacing = numberIn(field, op?.lineSpacing) ?? 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  if (depth > cone) {
    return `limited to the Ø${tool.diameter} mm bit’s ${round(cone)} mm cone`;
  }
  const width = tip + 2 * depth * tan;
  const meet = Math.max(0, (spacing - tip) / 2 / tan);
  if (!(spacing > 0)) {
    return `mm; grooves ${round(width)} mm wide`;
  }
  return `mm; grooves ${round(width)} mm wide on lines ${round(spacing)} mm apart — they meet at ${round(meet)} mm`;
}
