import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, shapeLabel } from './describe';
import { AbstractControl } from '@angular/forms';
import { ModelType as ShapeModelType } from '../shapes';

export interface ModelType {
  type: 'boolean';
  shape1Id: string;
  shape2Id: string;
  operationType: 'intersection' | 'union' | 'difference' | 'xor';
  fillRule: 'even-odd' | 'non-zero' | 'positive' | 'negative';
}

const selectShapeCommonField = {
  type: 'enum',
  validators: {
    shapeExists: {
      expression: (control: AbstractControl, field: FormlyFieldConfig) =>
        !control.value ||
        allShapes(field).some(
          (s) => s.id === control.value && s.id !== field.model?.id,
        ),
      message: 'This shape was deleted — pick another one',
    },
  },
  expressions: {
    'props.options': (field: FormlyFieldConfig) => {
      const shapes: ShapeModelType['shapes'] =
        field.parent?.parent?.parent?.model ?? [];
      return shapes
        .filter((shape) => shape.id !== field.model.id)
        .map((shape) => ({
          value: shape.id,
          label: shapeLabel(shape, shapes),
        }));
    },
  },
};

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'shape1Id',
      props: {
        label: 'shape 1',
        required: true,
      },
      ...selectShapeCommonField,
    },
    {
      key: 'shape2Id',
      props: {
        label: 'shape 2',
        required: true,
      },
      ...selectShapeCommonField,
    },
    {
      key: 'operationType',
      type: 'enum',
      defaultValue: 'intersection',
      props: {
        label: 'type',
        required: true,
        options: [
          { value: 'intersection', label: 'intersection' },
          { value: 'union', label: 'union' },
          { value: 'difference', label: 'difference' },
          { value: 'xor', label: 'xor' },
        ],
      },
    },
    {
      key: 'fillRule',
      type: 'enum',
      defaultValue: 'non-zero',
      props: {
        label: 'type',
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
