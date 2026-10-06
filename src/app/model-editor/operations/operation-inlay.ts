import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';

/**
 * The plug (male part) of a v-carve inlay. The pocket (female part) is an
 * ordinary v-carve with a max depth; this carves, on a second board, the
 * mirrored design standing proud, with V-walls matching the pocket's. Glued
 * in face down, the plug's walls meet the pocket's, `inlayGap` above its
 * flat bottom; the rest is planed off.
 */
export interface ModelType {
  type?: 'inlay-plug';
  /** The v-carve that cuts the pocket. */
  vcarveOperationId: string;
  /** Space left under the plug for glue (mm). */
  inlayGap: number;
  /** How far the plug's backing stands above the pocket's surface (mm). */
  inlayAbove: number;
  /** Material left round the design (mm). */
  inlayMargin: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'vcarveOperationId',
      type: 'enum',
      props: {
        label: 'pocket',
        description: 'the v-carve (with a max depth) cutting the pocket',
        required: true,
      },
      validators: {
        isPocket: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allOperations(field).some(
              (o) =>
                o.id === control.value &&
                o.type === 'v-carve' &&
                !o.unlimitedDepth,
            ),
          message:
            'Pick a v-carve with a max depth: the plug is made to match it',
        },
        sameAngle: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) => {
            const tools = allTools(field);
            const pocket = allOperations(field).find(
              (o) => o.id === control.value,
            );
            const pocketBit = tools.find((t) => t.id === pocket?.toolId);
            const plugBit = tools.find((t) => t.id === field.model?.toolId);
            return (
              pocketBit?.bitType !== 'v-bit' ||
              plugBit?.bitType !== 'v-bit' ||
              pocketBit.vAngle === plugBit.vAngle
            );
          },
          message:
            'The plug needs a V-bit of the same angle as the pocket’s, or its walls won’t meet',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const shapes = allShapes(field);
          const tools = allTools(field);
          return operations
            .filter((o) => o.type === 'v-carve')
            .map((o) => ({
              value: o.id,
              label: o.name || describeOperation(o, shapes, tools, operations),
            }));
        },
      },
    },
    {
      key: 'inlayGap',
      type: 'number',
      defaultValue: 0.5,
      props: {
        label: 'glue gap',
        description: 'mm left under the plug, above the pocket’s floor',
        min: 0,
        required: true,
      },
    },
    {
      key: 'inlayAbove',
      type: 'number',
      defaultValue: 1.5,
      props: {
        label: 'stands proud',
        description:
          'mm the plug’s backing stays above the surface, to plane off',
        min: 0,
        required: true,
      },
    },
    {
      key: 'inlayMargin',
      type: 'number',
      defaultValue: 5,
      props: {
        label: 'margin',
        description: 'mm of plug board carved round the design',
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
  type: 'inlay-plug',
  label: 'v-carve inlay plug',
  fieldGroup: field,
} as const;
