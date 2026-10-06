import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';

/**
 * Rough out a v-carve with an end mill: pocket the bulk of the material in
 * depth steps, leaving the sloped walls for the V-bit. Geometry comes from
 * the referenced v-carve operation (its shape, bit and depths), so this
 * follows any change made to it.
 */
export interface ModelType {
  type?: 'v-carve-clear';
  vcarveOperationId: string;
  depthPerStep: number;
  toolEngagement: number;
  leaveStock: number;
}

/** What a clearing can clear for: a v-carve, or an inlay plug. */
const CLEARS = ['v-carve', 'inlay-plug'];

const hideUnlessClearing = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'vcarveOperationId',
      type: 'enum',
      props: {
        label: 'v-carve',
        required: true,
      },
      validators: {
        isVCarve: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allOperations(field).some(
              (o) => o.id === control.value && CLEARS.includes(o.type),
            ),
          message: 'This v-carve was deleted or changed type — pick another',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const shapes = allShapes(field);
          const tools = allTools(field);
          return operations
            .filter((o) => CLEARS.includes(o.type))
            .map((o) => ({
              value: o.id,
              label: o.name || describeOperation(o, shapes, tools, operations),
            }));
        },
        // Clearing has to run before the V-bit finishes the walls.
        'props.description': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const self = operations.indexOf(field.model);
          const target = operations.findIndex(
            (o) => o.id === field.model?.vcarveOperationId,
          );
          return target !== -1 && self > target
            ? 'Runs after its v-carve — drag it above so the end mill clears first.'
            : 'The end mill pockets the bulk; the V-bit then cuts the walls.';
        },
      },
    },
    {
      key: 'depthPerStep',
      type: 'number',
      defaultValue: 2,
      props: {
        min: 0.01,
        label: 'depth/step',
        required: true,
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.4,
      props: {
        min: 0.01,
        max: 1,
        label: 'engagement',
        required: true,
      },
    },
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0.1,
      props: {
        min: 0,
        label: 'leave stock',
        description: 'left on the walls for the V-bit, in mm',
        required: true,
      },
    },
  ],
  expressions: {
    hide: hideUnlessClearing,
  },
};

export const Definition = {
  type: 'v-carve-clear',
  label: 'v-carve clearing',
  fieldGroup: field,
} as const;
