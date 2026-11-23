import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn } from '../variables/field';
import { allTools, stepoverDiameter } from '../tools';
import { imagePlacementField, ImagePlacementModel } from './image-placement';
import { onRotary } from './rotation';
import { allShapes } from '../shapes/describe';

/**
 * A relief carved in 3D, usually with a ball nose: from a greyscale image
 * (light high, dark deep) laid on the shape's bounding box, or a 3D model
 * shape where it is; clipped by the shape. Raster lines across it,
 * the bit as low as it goes at each point without cutting into the relief.
 */
export interface ModelType extends ImagePlacementModel {
  type?: 'relief';
  /**
   * What's carved: a height-map image (`reliefFile`, laid on the shape) or
   * a 3D model shape (`modelShapeId`), where it is. An image when left out.
   */
  reliefSource?: 'image' | 'model';
  /** The 3D model shape to carve (see `reliefModelShapeId`). */
  modelShapeId?: string;
  /**
   * For a 3D model carved without a shape to carve within: how far round
   * the rectangle round the model is carved too (mm).
   */
  reliefMargin?: number;
  /**
   * The model turns with the stock on its rotary axis: turned to each
   * angle, the operation carves the side that's up then.
   */
  modelTurns?: boolean;
  /**
   * With the model turning, cut at several angles: each finishes only what
   * faces it more squarely than any other (on unless turned off; see
   * `leftToOtherAngles`).
   */
  modelSectors?: boolean;
  /**
   * Carved all round (wrapped, the model turning): in raster lines, or one
   * spiral round the stock from end to end. Lines when left out.
   */
  aroundPattern?: 'lines' | 'spiral';
  /**
   * The height-map image, as a data URL. (Reliefs made before 3D model
   * shapes may hold an STL file here: still carved as it was, seen from
   * above and laid out like an image.)
   */
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
      key: 'reliefSource',
      type: 'enum',
      defaultValue: 'image',
      props: {
        label: 'relief from',
        required: true,
        options: [
          { value: 'image', label: 'a height-map image' },
          { value: 'model', label: 'a 3D model shape' },
        ],
      },
    },
    {
      key: 'modelShapeId',
      type: 'enum',
      props: {
        label: '3D model',
        description:
          'carved where it is, its heights as they are (Z 0 the top of the stock)',
        required: true,
        options: [],
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) =>
          modelShapes(field).map((s) => ({
            value: s.id,
            label: s.name || s['fileName'] || '3D model',
          })),
        hide: (field: FormlyFieldConfig) => !carvesModel(field),
      },
      validators: {
        exists: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            modelShapes(field).some((s) => s.id === control.value),
          message: 'This 3D model was deleted or changed type — pick another',
        },
      },
    },
    {
      key: 'reliefMargin',
      type: 'number',
      defaultValue: 5,
      props: {
        label: 'margin',
        description:
          'mm carved round the rectangle the model is in, so the bit gets down its sides; or pick a shape to carve within',
        min: 0,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          !carvesModel(field) || !!field.model?.shapeId,
      },
    },
    {
      key: 'modelTurns',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'the model turns with the stock',
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          field.model?.wrap
            ? 'carved all round in one go: the model is on the blank as at 0°, and the stock turns under the bit as it carves (lines at 0° run along the axis, at 90° round it); whatever shape is picked, from one end of the model to the other and the margin past them'
            : 'carved in the round: the model is on the blank as at 0°, and at each angle the stock is turned to (rotate steps, a rotary repeat) the side that’s up is carved; wrapped round the stock as well, it’s carved all round in one go instead',
        hide: (field: FormlyFieldConfig) =>
          !carvesModel(field) || !onRotary(field),
      },
    },
    {
      key: 'aroundPattern',
      type: 'enum',
      defaultValue: 'lines',
      props: {
        label: 'all round in',
        required: true,
        options: [
          { value: 'lines', label: 'lines, at the line angle' },
          { value: 'spiral', label: 'a spiral round the stock' },
        ],
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          field.model?.aroundPattern === 'spiral'
            ? 'one cut from end to end, the stock turning the same way all along, a stepover further along each turn (the line angle and the options below aren’t used). The axis is turned back all those turns when the job ends'
            : 'lines at 0° run along the axis, the stock turning a step between them; at 90° they’re rings, a turn one way and a turn back',
        hide: (field: FormlyFieldConfig) => !carvesAround(field),
      },
    },
    {
      key: 'modelSectors',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'each angle finishes only what faces it',
        description:
          'cut at several angles, each leaves the sides another angle faces more squarely (and whose bit gets there) to that one: quicker, and a better finish than a bit leaves on what it meets side on',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          !carvesModel(field) ||
          !onRotary(field) ||
          !field.model?.modelTurns ||
          !!field.model?.wrap,
      },
    },
    {
      key: 'reliefFile',
      type: 'file',
      props: {
        label: 'height map',
        description: 'a greyscale image: light stands high, dark goes deep',
        accept: 'image/*',
        readAs: 'dataUrl',
        fileNameKey: 'fileName',
        required: true,
      },
      expressions: { hide: carvesModel },
    },
    {
      ...imagePlacementField('placement'),
      expressions: { hide: (field: FormlyFieldConfig) => hideFileField(field) },
    },
    {
      key: 'reliefDepth',
      type: 'number',
      defaultValue: 3,
      props: {
        label: 'depth',
        min: 0.01,
        required: true,
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          carvesModel(field)
            ? 'mm below the top of the stock (as turned), at most: what of the model is lower isn’t carved'
            : 'mm, where the relief is lowest',
      },
    },
    {
      key: 'invertRelief',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'carve the high parts deepest (a mould)' },
      expressions: { hide: carvesModel },
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
      expressions: { hide: carvesModel },
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

/** The model's 3D model shapes, from any field of the form. */
function modelShapes(field: FormlyFieldConfig) {
  return allShapes(field).filter((s) => s.type === 'model');
}

/** Whether a field's relief carves its model all round as the stock turns. */
function carvesAround(field: FormlyFieldConfig): boolean {
  return (
    carvesModel(field) &&
    onRotary(field) &&
    !!field.model?.modelTurns &&
    !!field.model?.wrap
  );
}

/** Whether the relief a field belongs to carves a 3D model shape. */
function carvesModel(field: FormlyFieldConfig): boolean {
  return (
    field.model?.type === Definition.type &&
    field.model?.reliefSource === 'model'
  );
}

function hideFileField(field: FormlyFieldConfig): boolean {
  // The group's model is the operation's.
  return field.model?.type !== Definition.type || carvesModel(field);
}

/**
 * The shape a relief is carved in: the one picked, or, for a 3D model
 * without one, the model's own (the rectangle round it; the worker carves
 * within that and the relief's margin).
 */
export function reliefShapeId(
  op:
    | {
        shapeId?: string | null;
        reliefSource?: string;
        modelShapeId?: string | null;
      }
    | undefined,
): string | undefined {
  return (
    op?.shapeId ||
    (op?.reliefSource === 'model' ? op.modelShapeId || undefined : undefined)
  );
}

/**
 * The 3D model shape a relief carves: undefined for a relief from an
 * image, null when the one picked isn't there (nothing is carved then).
 */
export function reliefModelShapeId(
  op: { reliefSource?: string; modelShapeId?: string | null } | undefined,
  shapes: readonly { id?: string; type?: string }[],
): string | null | undefined {
  if (op?.reliefSource !== 'model') {
    return undefined;
  }
  const id = op.modelShapeId;
  return id && shapes.some((s) => s.id === id && s.type === 'model')
    ? id
    : null;
}

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
  const tapered = tool?.bitType === 'tapered-ball-nose';
  // A tapered ball nose's stepover goes by the ball at its tip.
  const diameter = stepoverDiameter({
    bitType: tool?.bitType,
    diameter: numberIn(field, tool?.diameter),
    tipRadius: numberIn(field, tool?.tipRadius),
  });
  if (!(diameter > 0) || !(share > 0)) {
    return tapered
      ? 'share of the diameter of the ball at the bit’s tip between lines'
      : 'share of the bit’s diameter between lines';
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const step = share * diameter;
  const r = diameter / 2;
  if (tapered) {
    // Lines further apart than the ball is wide leave the taper's ridges.
    const angle = ((numberIn(field, tool?.taperAngle) ?? 0) * Math.PI) / 180;
    return step / 2 > r * Math.cos(angle)
      ? `${round(step)} mm between lines: wider than the Ø${round(diameter)} ball at the tip`
      : `${round(step)} mm between lines (of the Ø${round(diameter)} ball at the tip); scallops ${round(r - Math.sqrt(Math.max(0, r * r - (step / 2) ** 2)))} mm high`;
  }
  if (tool?.bitType !== 'ball-nose') {
    return `${round(step)} mm between lines`;
  }
  const scallop = r - Math.sqrt(Math.max(0, r * r - (step / 2) ** 2));
  return `${round(step)} mm between lines; scallops ${round(scallop)} mm high`;
}
