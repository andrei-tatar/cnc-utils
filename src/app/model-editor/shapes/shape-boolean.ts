import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, dependsOn, shapeLabel } from './describe';
import { AbstractControl } from '@angular/forms';

export type BooleanOperationType =
  'intersection' | 'union' | 'difference' | 'xor';

/**
 * One shape of a boolean, and how it's combined with the result of the
 * ones above it. The first shape has no operation: it's the starting point.
 */
export interface BooleanOperand {
  id?: string;
  shapeId: string;
  operation?: BooleanOperationType;
}

export interface ModelType {
  type: 'boolean';
  /** Applied in order: ((s1 op2 s2) op3 s3) …. */
  operands: BooleanOperand[];
  fillRule: 'even-odd' | 'non-zero' | 'positive' | 'negative';
}

/** The boolean shape an operand's field belongs to. */
function owningShape(field: FormlyFieldConfig): any {
  let current = field.parent;
  while (current && current.model?.type !== 'boolean') {
    current = current.parent;
  }
  return current?.model;
}

/** Whether the operand's field is in the list's first row. */
function isFirstOperand(field: FormlyFieldConfig): boolean {
  return Number(field.parent?.key) === 0;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'operands',
      type: 'repeat',
      // A new boolean starts with two shapes to combine.
      defaultValue: [{}, {}],
      props: {
        label: 'shapes',
        itemLabel: 'shape',
        inline: true,
        description:
          'Combined in order: each shape with the result of the ones above it.',
      },
      validators: {
        twoShapes: {
          expression: (control: AbstractControl) =>
            (control.value?.length ?? 0) >= 2,
          message: 'Add at least two shapes',
        },
      },
      fieldArray: {
        fieldGroupClassName: 'operand-row',
        fieldGroup: [
          {
            key: 'id',
            type: 'hidden',
            className: 'd-none',
          },
          {
            key: 'operation',
            type: 'enum',
            className: 'operand-operation',
            defaultValue: 'union',
            props: {
              required: true,
              attributes: { 'aria-label': 'operation' },
              options: [
                { value: 'union', label: '∪ union' },
                { value: 'difference', label: '− subtract' },
                { value: 'intersection', label: '∩ intersect' },
                { value: 'xor', label: '⊕ xor' },
              ],
            },
            expressions: {
              // The first shape is what the others are applied to.
              hide: isFirstOperand,
            },
          },
          {
            key: 'shapeId',
            type: 'enum',
            className: 'operand-shape',
            props: {
              required: true,
              placeholder: 'shape',
              attributes: { 'aria-label': 'shape' },
            },
            validators: {
              shapeExists: {
                expression: (
                  control: AbstractControl,
                  field: FormlyFieldConfig,
                ) =>
                  !control.value ||
                  allShapes(field).some((s) => s.id === control.value),
                message: 'This shape was deleted — pick another one',
              },
              noLoop: {
                expression: (
                  control: AbstractControl,
                  field: FormlyFieldConfig,
                ) =>
                  !control.value ||
                  !dependsOn(
                    control.value,
                    owningShape(field)?.id,
                    allShapes(field),
                  ),
                message:
                  'That shape takes its geometry from this one — pick another',
              },
            },
            expressions: {
              'props.options': (field: FormlyFieldConfig) => {
                const shapes = allShapes(field);
                const ownId = owningShape(field)?.id;
                return shapes
                  .filter((shape) => !dependsOn(shape.id!, ownId, shapes))
                  .map((shape) => ({
                    value: shape.id,
                    label: shapeLabel(shape, shapes),
                  }));
              },
            },
          },
        ],
      },
    },
    {
      key: 'fillRule',
      type: 'enum',
      defaultValue: 'non-zero',
      props: {
        label: 'fill rule',
        required: true,
        options: [
          { value: 'even-odd', label: 'even-odd' },
          { value: 'non-zero', label: 'non-zero' },
          { value: 'positive', label: 'positive' },
          { value: 'negative', label: 'negative' },
        ],
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'boolean',
  label: 'boolean',
  fieldGroup: field,
} as const;
