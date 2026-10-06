import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';

/**
 * Rest machining: a smaller tool clears what a pocket's larger tool
 * couldn't reach (tight corners, narrow gaps), and nothing else. The shape
 * and depths come from the pocket.
 */
export interface ModelType {
  type?: 'rest';
  /** The pocket to finish. */
  pocketOperationId: string;
  toolEngagement: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'pocketOperationId',
      type: 'enum',
      props: {
        label: 'after pocket',
        required: true,
      },
      validators: {
        isPocket: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allOperations(field).some(
              (o) => o.id === control.value && o.type === 'pocket',
            ),
          message: 'This pocket was deleted or changed type — pick another',
        },
        smallerTool: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) => {
            const pocket = allOperations(field).find(
              (o) => o.id === control.value,
            );
            const tools = allTools(field);
            const previous = tools.find((t) => t.id === pocket?.toolId);
            const own = tools.find((t) => t.id === field.model?.toolId);
            return !previous || !own || own.diameter < previous.diameter;
          },
          message: 'Needs a smaller tool than the pocket’s',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const operations = allOperations(field);
          const shapes = allShapes(field);
          const tools = allTools(field);
          return operations
            .filter((o) => o.type === 'pocket')
            .map((o) => ({
              value: o.id,
              label: o.name || describeOperation(o, shapes, tools, operations),
            }));
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
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'rest',
  label: 'rest machining',
  fieldGroup: field,
} as const;
