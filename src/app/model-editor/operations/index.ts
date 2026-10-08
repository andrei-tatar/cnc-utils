import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn, resolvedModelOf } from '../variables/field';
import { allShapes, shapeLabel } from '../shapes/describe';
import {
  allTools,
  BitType,
  ROUND_CUTTERS,
  numberedToolLabel,
  SIDE_CUTTING,
} from '../tools';
import { allOperations, describeOperation } from './describe';
import {
  operationFeedsAndSpeeds,
  ToolOverrides,
} from '../tools/feeds-and-speeds';
import { autoFeedsField, calculatedFeedExpressions } from './feeds-calculator';

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

import {
  Definition as DrillDefinition,
  ModelType as DrillModelType,
} from './operation-drill';

import {
  Definition as HelixDefinition,
  ModelType as HelixModelType,
} from './operation-helix';

import {
  Definition as ChamferDefinition,
  ModelType as ChamferModelType,
} from './operation-chamfer';

import {
  Definition as InlayDefinition,
  ModelType as InlayModelType,
} from './operation-inlay';

import {
  Definition as RestDefinition,
  ModelType as RestModelType,
} from './operation-rest';

import {
  Definition as FlatPlugDefinition,
  ModelType as FlatPlugModelType,
} from './operation-flat-plug';

import {
  Definition as KeyholeDefinition,
  ModelType as KeyholeModelType,
} from './operation-keyhole';

import {
  Definition as ImageEngraveDefinition,
  ModelType as ImageEngraveModelType,
} from './operation-image-engrave';

import {
  Definition as ImageEngraveClearDefinition,
  ModelType as ImageEngraveClearModelType,
} from './operation-image-engrave-clear';

const operations = [
  PocketDefinition,
  ProfileDefinition,
  RestDefinition,
  FlatPlugDefinition,
  FlatDefinition,
  DrillDefinition,
  HelixDefinition,
  KeyholeDefinition,
  ChamferDefinition,
  VCarveDefinition,
  VCarveClearDefinition,
  InlayDefinition,
  ImageEngraveDefinition,
  ImageEngraveClearDefinition,
];

// The bits each operation works with (and how to say so when it doesn't).
const allowedBits: Record<
  string,
  { bits: readonly BitType[]; needs: string } | undefined
> = {
  [PocketDefinition.type]: {
    bits: SIDE_CUTTING,
    needs: 'a cutter, not a drill',
  },
  [ProfileDefinition.type]: {
    bits: SIDE_CUTTING,
    needs: 'a cutter, not a drill',
  },
  [FlatDefinition.type]: { bits: SIDE_CUTTING, needs: 'a cutter, not a drill' },
  [RestDefinition.type]: { bits: ROUND_CUTTERS, needs: 'an end mill' },
  [HelixDefinition.type]: { bits: ROUND_CUTTERS, needs: 'an end mill' },
  [VCarveDefinition.type]: { bits: ['v-bit'], needs: 'a V-bit' },
  [InlayDefinition.type]: { bits: ['v-bit'], needs: 'a V-bit' },
  [ChamferDefinition.type]: { bits: ['v-bit'], needs: 'a V-bit' },
  [VCarveClearDefinition.type]: { bits: ROUND_CUTTERS, needs: 'an end mill' },
  [FlatPlugDefinition.type]: { bits: ROUND_CUTTERS, needs: 'an end mill' },
  [KeyholeDefinition.type]: { bits: ['keyhole'], needs: 'a keyhole bit' },
  [ImageEngraveDefinition.type]: { bits: ['v-bit'], needs: 'a V-bit' },
  [ImageEngraveClearDefinition.type]: {
    bits: ROUND_CUTTERS,
    needs: 'an end mill',
  },
};

function allowsBit(type: string, bit: BitType) {
  return allowedBits[type]?.bits.includes(bit) ?? true;
}

// Operations that take their shape from another operation.
const borrowsShape = new Set<string>([
  VCarveClearDefinition.type,
  InlayDefinition.type,
  RestDefinition.type,
  FlatPlugDefinition.type,
  ImageEngraveClearDefinition.type,
]);

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
        | DrillModelType
        | HelixModelType
        | ChamferModelType
        | InlayModelType
        | RestModelType
        | KeyholeModelType
        | FlatPlugModelType
        | ImageEngraveModelType
        | ImageEngraveClearModelType
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
    clonable: true,
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
              resolvedModelOf(field),
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
              label: numberedToolLabel(tool, numberIn(field, tool.index)),
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
          // Clearing, inlay plugs and rest machining use the shape of the
          // operation they belong to.
          hide: (field: FormlyFieldConfig) =>
            borrowsShape.has(field.model?.type),
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
              const tool = allTools(field).find(
                (t) => t.id === field.model?.toolId,
              );
              return (
                !tool || allowsBit(control.value, tool.bitType ?? 'end-mill')
              );
            },
            message: (_: unknown, field: FormlyFieldConfig) => {
              const type = field.formControl?.value;
              const label = operations.find((o) => o.type === type)?.label;
              return `${label ?? type} needs ${allowedBits[type]?.needs ?? 'another tool'}`;
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
                  allowsBit(t.type, bitType) || t.type === field.model?.type,
              )
              .map((t) => ({ value: t.type, label: t.label }));
          },
        },
      },
      ...operations.map((t) => t.fieldGroup),
      // Only these ramp into their cuts.
      operationFeedsAndSpeeds(
        { field: autoFeedsField, expressions: calculatedFeedExpressions },
        [
          PocketDefinition.type,
          ProfileDefinition.type,
          VCarveDefinition.type,
          VCarveClearDefinition.type,
          RestDefinition.type,
          ChamferDefinition.type,
          InlayDefinition.type,
          FlatPlugDefinition.type,
          ImageEngraveClearDefinition.type,
        ],
      ),
    ],
  },
};
