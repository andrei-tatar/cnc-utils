import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes } from '../shapes/describe';
import { allTools } from '../tools';
import { allOperations, describeOperation } from './describe';
import { DepthSteps, depthStepsFields } from './depth-steps';

/**
 * The plug for a flat-bottomed inlay: cut out round the outline a pocket
 * (cut with an end mill) really has — its corners rounded by that bit —
 * less a glue gap, so it drops into the pocket. Cut from the inlay board;
 * the depth is the plug's thickness.
 */
export interface ModelType extends DepthSteps {
  type?: 'flat-plug';
  /** The pocket the plug fills. */
  pocketOperationId: string;
  /** Gap all round between the plug and the pocket's wall (mm). */
  inlayGap: number;
  /** Mirror left–right, for a plug glued in face down. */
  plugMirror: boolean;
  direction: 'climb' | 'conventional';
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'pocketOperationId',
      type: 'enum',
      props: {
        label: 'for pocket',
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
      key: 'inlayGap',
      type: 'number',
      defaultValue: 0.1,
      props: {
        label: 'glue gap',
        description: 'mm all round between the plug and the pocket’s wall',
        min: 0,
        required: true,
      },
    },
    {
      key: 'plugMirror',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'mirror left–right (the plug goes in face down)',
      },
    },
    {
      key: 'direction',
      type: 'enum',
      defaultValue: 'climb',
      props: {
        label: 'direction',
        required: true,
        options: [
          { value: 'climb', label: 'climb' },
          { value: 'conventional', label: 'conventional' },
        ],
      },
    },
    ...depthStepsFields(),
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'flat-plug',
  label: 'flat inlay plug',
  fieldGroup: field,
} as const;
