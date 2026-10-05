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

import {
  Definition as ProfileDefinition,
  ModelType as ProfileModelType,
} from './operation-profile';

import {
  Definition as VCarveDefinition,
  ModelType as VCarveModelType,
} from './operation-vcarve';

const operations = [
  PocketDefinition,
  FlatDefinition,
  ProfileDefinition,
  VCarveDefinition,
];

// Operations that only make sense with a particular bit; others work with any.
const requiredBitType: Partial<Record<string, string>> = {
  [VCarveDefinition.type]: 'v-bit',
};

export type ModelType = {
  operations: Array<
    {
      id: string;
      expanded: boolean;
      name: string;
      shapeId: string;
    } & (
      | PocketModelType
      | FlatModelType
      | ProfileModelType
      | VCarveModelType
    )
  >;
};

export const field: FormlyFieldConfig = {
  key: 'operations',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'operations',
    itemLabel: 'operation',
    accent: '#059669',
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
        },
        expressions: {
          'props.options': (field: FormlyFieldConfig) => {
            const bitType =
              field.parent?.parent?.parent?.model?.bitType ?? 'end-mill';
            return operations
              .filter(
                (t) =>
                  !requiredBitType[t.type] ||
                  requiredBitType[t.type] === bitType ||
                  t.type === field.model?.type,
              )
              .map((t) => ({ value: t.type, label: t.label }));
          },
        },
      },
      ...operations.map((t) => t.fieldGroup),
    ],
  },
};
