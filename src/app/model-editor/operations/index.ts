import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, shapeLabel } from '../shapes/describe';
import { allTools, toolLabel } from '../tools';
import { allOperations, describeOperation } from './describe';
import {
  operationFeedsAndSpeeds,
  ToolOverrides,
} from '../tools/feeds-and-speeds';

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

import {
  Definition as VCarveClearDefinition,
  ModelType as VCarveClearModelType,
} from './operation-vcarve-clear';

const operations = [
  PocketDefinition,
  FlatDefinition,
  ProfileDefinition,
  VCarveDefinition,
  VCarveClearDefinition,
];

const BIT_NAMES: Record<string, string> = {
  'v-bit': 'a V-bit',
  'end-mill': 'an end mill',
};

// Operations that only make sense with a particular bit; others work with any.
const requiredBitType: Partial<Record<string, string>> = {
  [VCarveDefinition.type]: 'v-bit',
  [VCarveClearDefinition.type]: 'end-mill',
};

export type ModelType = {
  operations: Array<
    {
      id: string;
      expanded: boolean;
      name?: string;
      /** Left out of the G-code (and so the preview). */
      disabled?: boolean;
      toolId: string;
      shapeId: string;
    } & ToolOverrides &
      (
        | PocketModelType
        | FlatModelType
        | ProfileModelType
        | VCarveModelType
        | VCarveClearModelType
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
        allOperations(field),
      ),
    accent: '#059669',
    collapsible: true,
    toggle: {
      key: 'disabled',
      icon: 'switch',
      onTitle: 'Disable: leave out of the G-code and preview',
      offTitle: 'Disabled — click to include in the G-code again',
    },
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'disabled',
        type: 'hidden',
        defaultValue: false,
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
              allOperations(field),
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
        validators: {
          toolExists: {
            expression: (control: AbstractControl, field: FormlyFieldConfig) =>
              !control.value ||
              allTools(field).some((t) => t.id === control.value),
            message: 'This tool was deleted — pick another one',
          },
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
        validators: {
          shapeExists: {
            expression: (control: AbstractControl, field: FormlyFieldConfig) =>
              !control.value ||
              allShapes(field).some((s) => s.id === control.value),
            message: 'This shape was deleted — pick another one',
          },
        },
        expressions: {
          // Clearing uses the shape of the v-carve it clears for.
          hide: (field: FormlyFieldConfig) =>
            field.model?.type === VCarveClearDefinition.type,
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
        validators: {
          bitType: {
            expression: (
              control: AbstractControl,
              field: FormlyFieldConfig,
            ) => {
              const required = requiredBitType[control.value];
              const tool = allTools(field).find(
                (t) => t.id === field.model?.toolId,
              );
              return (
                !required || !tool || (tool.bitType ?? 'end-mill') === required
              );
            },
            message: (_: unknown, field: FormlyFieldConfig) => {
              const type = field.formControl?.value;
              const label = operations.find((o) => o.type === type)?.label;
              return `${label ?? type} needs ${BIT_NAMES[requiredBitType[type] ?? ''] ?? 'another'} tool`;
            },
          },
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
      // Only these ramp into their cuts.
      operationFeedsAndSpeeds([
        PocketDefinition.type,
        ProfileDefinition.type,
        VCarveClearDefinition.type,
      ]),
    ],
  },
};
