import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';

/**
 * Roughing for a 3D relief: an end mill takes away the bulk, level by
 * level, never closer than `leaveStock` to the relief; the relief's own
 * pass after it finishes. The shape and relief come from the relief.
 */
export interface ModelType {
  type?: 'relief-rough';
  /** The relief to rough out. */
  reliefOperationId: string;
  /** Share of the end mill's diameter between passes. */
  toolEngagement: number;
  depthPerStep: number;
  /** Left for the finishing pass (mm). */
  leaveStock: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'reliefOperationId',
      type: 'enum',
      props: {
        label: 'for relief',
        required: true,
      },
      validators: {
        isRelief: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allOperations(field).some(
              (o) => o.id === control.value && o.type === 'relief',
            ),
          message: 'This relief was deleted or changed type — pick another',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const shapes = allShapes(field);
          const tools = allTools(field);
          return operations
            .filter((o) => o.type === 'relief')
            .map((o) => ({
              value: o.id,
              label: o.name || describeOperation(o, shapes, tools, operations),
            }));
        },
        'props.description': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const own = operations.indexOf(field.model);
          const relief = operations.findIndex(
            (o) => o.id === field.model?.reliefOperationId,
          );
          return relief >= 0 && relief < own
            ? 'comes after the relief: move it before, so the finishing pass only takes what’s left'
            : '';
        },
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
      key: 'depthPerStep',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 0.01,
        label: 'depth per step',
        required: true,
      },
    },
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0.3,
      props: {
        min: 0,
        label: 'leave for finishing',
        description: 'mm above the relief',
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'relief-rough',
  label: '3D relief roughing',
  fieldGroup: field,
} as const;
