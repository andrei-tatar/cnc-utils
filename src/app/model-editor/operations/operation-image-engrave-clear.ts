import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';

/**
 * Clearing for an image engraving: an end mill takes away the bulk of what
 * the engraving's V-bit would, level by level, never closer than
 * `leaveStock` to what the engraving leaves; the V-bit after it finishes.
 * The shape, image and depths come from the engraving.
 */
export interface ModelType {
  type?: 'image-engrave-clear';
  /** The image engraving to clear for. */
  engraveOperationId: string;
  /** Share of the end mill's diameter between passes. */
  toolEngagement: number;
  depthPerStep: number;
  /** Left for the V-bit (mm). */
  leaveStock: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'engraveOperationId',
      type: 'enum',
      props: {
        label: 'for image engraving',
        required: true,
      },
      validators: {
        isEngraving: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allOperations(field).some(
              (o) => o.id === control.value && o.type === 'image-engrave',
            ),
          message:
            'This image engraving was deleted or changed type — pick another',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const shapes = allShapes(field);
          const tools = allTools(field);
          return operations
            .filter((o) => o.type === 'image-engrave')
            .map((o) => ({
              value: o.id,
              label: o.name || describeOperation(o, shapes, tools, operations),
            }));
        },
        'props.description': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const own = operations.indexOf(field.model);
          const engraving = operations.findIndex(
            (o) => o.id === field.model?.engraveOperationId,
          );
          return engraving >= 0 && engraving < own
            ? 'comes after the engraving: move it before, so the V-bit only finishes'
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
      defaultValue: 0.2,
      props: {
        min: 0,
        label: 'leave for the V-bit',
        description: 'mm above what the engraving cuts',
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'image-engrave-clear',
  label: 'image engraving clearing',
  fieldGroup: field,
} as const;
