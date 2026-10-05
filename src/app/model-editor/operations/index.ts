import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, shapeLabel } from '../shapes/describe';
import { allTools, toolLabel } from '../tools';
import { describeOperation } from './describe';

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
      name?: string;
      toolId: string;
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
    describeItem: (operation: any, field: FormlyFieldConfig) =>
      describeOperation(
        operation,
        allShapes(field),
        allTools(field),
      ),
    accent: '#059669',
    collapsible: true,
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
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeOperation(
              field.model,
              allShapes(field),
              allTools(field),
            ),
        },
      },
      {
        key: 'toolId',
        type: 'enum',
        props: {
          label: 'tool',
          required: true,
        },
        expressions: {
          'props.options': (field: FormlyFieldConfig) =>
            allTools(field).map((tool) => ({
              value: tool.id,
              label: toolLabel(tool),
            })),
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
            const shapes = allShapes(field);
            return shapes.map((shape) => ({
              value: shape.id,
              label: shapeLabel(shape, shapes),
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
            const tool = allTools(field).find(
              (t) => t.id === field.model?.toolId,
            );
            const bitType = tool?.bitType ?? 'end-mill';
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
