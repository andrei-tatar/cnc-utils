import { FormlyFieldConfig } from '@ngx-formly/core';
import { allTools } from '../tools';
import { allOperations } from './describe';

export interface ModelType {
  type?: 'v-carve';
  /** Which part of the shape to carve (see ShapePart). */
  mode?: 'both' | 'holes' | 'contours';
  startDepth: number;
  /** No max depth: carve the full V everywhere, no flat bottom. */
  unlimitedDepth?: boolean;
  maxDepth: number;
  stepover: number;
  clearFlatBottom: boolean;
  sharpCorners: boolean;
  sharpCornerAngle: number;
}

const hideUnlessVCarve = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideIfUnlimited = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || !!field.model?.unlimitedDepth;

const hideUnlessSharpCorners = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || !field.model?.sharpCorners;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'mode',
      type: 'enum',
      defaultValue: 'both',
      props: {
        label: 'carve',
        required: true,
        options: [
          { value: 'both', label: 'outlines minus holes' },
          { value: 'holes', label: 'around the holes only' },
          { value: 'contours', label: 'outlines only, holes ignored' },
        ],
      },
    },
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'start depth',
        required: true,
      },
    },
    {
      key: 'unlimitedDepth',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'no max depth (full V, no flat bottom)',
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          field.model?.unlimitedDepth ? maxDepthHint(field) : '',
      },
    },
    {
      key: 'maxDepth',
      type: 'number',
      defaultValue: 3,
      props: {
        min: 0,
        label: 'max depth',
        required: true,
      },
      expressions: {
        hide: hideIfUnlimited,
        'props.description': (field: FormlyFieldConfig) => maxDepthHint(field),
      },
    },
    {
      key: 'stepover',
      type: 'number',
      defaultValue: 0.1,
      props: {
        min: 0.01,
        label: 'stepover',
        required: true,
      },
    },
    {
      key: 'clearFlatBottom',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'clear flat bottom at max depth',
      },
      expressions: { hide: hideIfUnlimited },
    },
    {
      key: 'sharpCorners',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'sharp corners',
      },
    },
    {
      key: 'sharpCornerAngle',
      type: 'number',
      defaultValue: 150,
      props: {
        min: 1,
        max: 179,
        label: 'sharpen corners up to (deg)',
        required: true,
      },
      expressions: { hide: hideUnlessSharpCorners },
    },
  ],
  expressions: {
    hide: hideUnlessVCarve,
  },
};

export const Definition = {
  type: 'v-carve',
  label: 'v-carve',
  fieldGroup: field,
} as const;

/**
 * Explain whether the V-bit limits the depth: without clearing it can't go
 * below its cone (the shank would push through the uncut middle); with a
 * v-carve clearing earlier in the list it can.
 */
function maxDepthHint(field: FormlyFieldConfig): string {
  const op = field.model;
  const tool = allTools(field).find((t) => t.id === op?.toolId);
  if (tool?.bitType !== 'v-bit' || !tool.vAngle || !tool.diameter) {
    return '';
  }
  const tan = Math.tan(((tool.vAngle / 2) * Math.PI) / 180);
  const cone =
    Math.round(
      (Math.max(0, tool.diameter / 2 - (tool.tipDiameter ?? 0) / 2) / tan) *
        100,
    ) / 100;
  const operations = allOperations(field);
  const index = operations.indexOf(op);
  const cleared = operations.some(
    (o, i) =>
      i < index &&
      o.type === 'v-carve-clear' &&
      o.vcarveOperationId === op?.id &&
      (allTools(field).find((t) => t.id === o.toolId)?.bitType ??
        'end-mill') !== 'v-bit',
  );
  if (op?.unlimitedDepth) {
    return cleared
      ? `cleared first, so it carves the full V however deep the shape needs`
      : `stops at the Ø${tool.diameter} mm bit's ${cone} mm cone where the shape is wider than the bit — add a v-carve clearing before this operation to carve the full V`;
  }
  if (cleared) {
    return `cleared first, so it can go below the bit's ${cone} mm cone`;
  }
  return +op?.maxDepth > cone
    ? `limited to ${cone} mm by the Ø${tool.diameter} mm bit — add a v-carve clearing before this operation to go deeper`
    : `the bit can reach ${cone} mm; deeper needs a v-carve clearing first`;
}
