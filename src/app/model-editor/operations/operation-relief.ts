import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn } from '../variables/field';
import { allTools } from '../tools';
import { imagePlacementField, ImagePlacementModel } from './image-placement';

/**
 * A relief carved in 3D, usually with a ball nose: from a greyscale image
 * (light high, dark deep) or an STL model seen from above, laid on the
 * shape's bounding box and clipped by the shape. Raster lines across it,
 * the bit as low as it goes at each point without cutting into the relief.
 */
export interface ModelType extends ImagePlacementModel {
  type?: 'relief';
  /** The image or STL model, as a data URL. */
  reliefFile: string;
  /** Name of the file it was loaded from (display only). */
  fileName?: string;
  /** How deep its lowest is carved (mm). */
  reliefDepth: number;
  /** Carve the high parts deepest instead (a mould). */
  invertRelief: boolean;
  /** Depth follows (1 − height) raised to this. */
  gamma: number;
  /** Blurred over about this far first (mm). */
  smoothing: number;
  /** Inside the shape, off the relief: carved to the full depth, or uncut. */
  reliefAround: 'floor' | 'surface';
  /** Share of the bit's diameter between raster lines. */
  toolEngagement: number;
  /** Direction of the lines, degrees counter-clockwise from the X axis. */
  rasterAngle: number;
  /** The relief is worked out on cells this size (mm). */
  sampleStep: number;
  allPassesInSameDirection: boolean;
  /** A second pass with the lines across the first. */
  crossPass: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    { key: 'fileName', type: 'hidden' },
    {
      key: 'reliefFile',
      type: 'file',
      props: {
        label: 'relief',
        description:
          'a greyscale image (light high, dark deep) or an STL model, seen from above',
        accept: 'image/*,.stl',
        readAs: 'dataUrl',
        fileNameKey: 'fileName',
        required: true,
      },
    },
    imagePlacementField('placement'),
    {
      key: 'reliefDepth',
      type: 'number',
      defaultValue: 3,
      props: {
        label: 'depth',
        description: 'mm, where the relief is lowest',
        min: 0.01,
        required: true,
      },
    },
    {
      key: 'invertRelief',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'carve the high parts deepest (a mould)' },
    },
    {
      key: 'gamma',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'gamma',
        description:
          '1: depth follows the relief; above 1 raises the middle heights, below lowers them',
        min: 0.1,
        required: true,
      },
    },
    {
      key: 'smoothing',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'smoothing',
        description:
          'mm; blurs the relief first, taking the steps out of an image',
        min: 0,
        required: true,
      },
    },
    {
      key: 'reliefAround',
      type: 'enum',
      defaultValue: 'floor',
      props: {
        label: 'in the shape, round the relief',
        required: true,
        options: [
          { value: 'floor', label: 'carved to the full depth' },
          { value: 'surface', label: 'left uncut' },
        ],
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.1,
      props: {
        label: 'stepover',
        min: 0.01,
        max: 1,
        required: true,
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) => stepoverHint(field),
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
        description: 'mm; finer follows the relief closer, but takes longer',
        min: 0.02,
        required: true,
      },
    },
    {
      key: 'crossPass',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'second pass across the first',
        description: 'smoother, and twice as long',
      },
    },
    {
      key: 'allPassesInSameDirection',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'all lines in the same direction',
        description: 'slower, but every line is cut alike',
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'relief',
  label: '3D relief',
  fieldGroup: field,
} as const;

/**
 * The stepover in mm, and for a ball nose the height of the ridges
 * (scallops) it leaves between lines on a flat.
 */
function stepoverHint(field: FormlyFieldConfig): string {
  const op = field.model;
  const tool = allTools(field).find((t) => t.id === op?.toolId);
  const share = numberIn(field, op?.toolEngagement) ?? 0;
  const diameter = numberIn(field, tool?.diameter) ?? 0;
  if (!(diameter > 0) || !(share > 0)) {
    return 'share of the bit’s diameter between lines';
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const step = share * diameter;
  if (tool?.bitType !== 'ball-nose') {
    return `${round(step)} mm between lines`;
  }
  const r = diameter / 2;
  const scallop = r - Math.sqrt(Math.max(0, r * r - (step / 2) ** 2));
  return `${round(step)} mm between lines; scallops ${round(scallop)} mm high`;
}
