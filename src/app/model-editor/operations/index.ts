import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapeModelType } from '../shapes';

import {
  Definition as PocketDefinition,
  ModelType as PocketModelType,
} from './operation-pocket';

import {
  Definition as FlatDefinition,
  ModelType as FlatModelType,
} from './operation-flat';

const operations = [PocketDefinition, FlatDefinition];

export type ModelType = {
  operations: Array<
    {
      id: string;
      expanded: boolean;
      name: string;
      shapeId: string;
    } & (PocketModelType | FlatModelType)
  >;
};

export const field: FormlyFieldConfig = {
  key: 'operations',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'operations',
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'expanded',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
          required: true,
        },
      },
      {
        key: 'shapeId',
        type: 'enum',
        props: {
          label: 'shape',
          required: true,
        },
        expressions: {
          'props.options': (field: FormlyFieldConfig) => {
            const shapes: ShapeModelType['shapes'] =
              field.parent?.parent?.parent?.parent?.parent?.model.shapes ?? [];
            return shapes.map((shape) => ({
              value: shape.id,
              label: shape.name || shape.type || 'unnamed',
            }));
          },
        },
      },
      {
        key: 'type',
        type: 'enum',
        props: {
          label: 'type',
          required: true,
          options: operations.map((t) => ({ value: t.type, label: t.label })),
        },
      },
      ...operations.map((t) => t.fieldGroup),
    ],
  },
};
