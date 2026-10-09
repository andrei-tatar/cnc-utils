import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn, resolvedModelOf } from '../variables/field';
import { allShapes, rootModel, shapeLabel } from '../shapes/describe';
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
import { onRotary, operationRotation } from './rotation';
import { isTurned } from '../../../cam/rotary';

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

import {
  Definition as RotateDefinition,
  ModelType as RotateModelType,
} from './operation-rotate';

import {
  ModelType as RotaryRepeatModelType,
  repeatAngles,
  rotaryRepeatDefinition,
} from './operation-rotary-repeat';
import { NO_TOOL, ROTARY_REPEAT } from './flatten';

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
  RotateDefinition,
];

/** The stock is a cylinder held on a rotary axis. */
const onRoundStock = (field: FormlyFieldConfig) =>
  onRotary(field) && rootModel(field)?.stock?.shape === 'cylinder';

/** Rotate steps and rotary repeats: no tool, no shape, nothing cut. */
const cutsNothing = (field: FormlyFieldConfig) =>
  NO_TOOL.has(field.model?.type);

/** What an operation of `type` is called in the editor. */
export function operationLabel(type: string | undefined): string {
  return (
    typesIn(false).find((o) => o.type === type)?.label ?? type ?? 'operation'
  );
}

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
      /**
       * Wrapped round a round stock: drawn unrolled, across the axis is
       * round it (see `rotate` in gcode-builder.ts). Not a routing input.
       */
      wrap?: boolean;
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
        | RotateModelType
        | RotaryRepeatModelType
      )
  >;
};

/** The operations list's settings (the outer list, or a repeat's own). */
function listProps(inner: boolean): FormlyFieldConfig['props'] {
  return {
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
    // With the stock on a rotary axis, how far it's turned for each
    // operation (by the rotate steps above it), or how many angles a
    // rotary repeat cuts at.
    itemTag: (operation: any, field: FormlyFieldConfig) => {
      if (!onRotary(field) || inner || operation?.type === 'rotate') {
        return null;
      }
      if (operation?.type === ROTARY_REPEAT) {
        return `×${repeatAngles(operation).length}`;
      }
      const angle = operationRotation(
        operation,
        rootModel(field)?.operations ?? [],
        (value) => numberIn(field, value as any),
      );
      return isTurned(angle) ? `A${Math.round(angle * 1000) / 1000}` : null;
    },
    // A repeat's list isn't a section: nothing to fold away.
    collapsible: !inner,
    clonable: true,
    toggle: {
      key: 'disabled',
      icon: 'switch',
      onTitle: 'Disable: leave out of the G-code and preview',
      offTitle: 'Disabled — click to include in the G-code again',
    },
  };
}

/** Types of operation that can go in a list (a repeat's: no rotating). */
function typesIn(inner: boolean) {
  return inner ? operations : [...operations, rotaryRepeat];
}

/** An operation's fields (in the outer list, or inside a rotary repeat). */
function operationFields(inner: boolean): FormlyFieldConfig[] {
  const types = typesIn(inner);
  return [
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
        hide: cutsNothing,
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
          borrowsShape.has(field.model?.type) || cutsNothing(field),
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
          expression: (control: AbstractControl, field: FormlyFieldConfig) => {
            const tool = allTools(field).find(
              (t) => t.id === field.model?.toolId,
            );
            return (
              !tool || allowsBit(control.value, tool.bitType ?? 'end-mill')
            );
          },
          message: (_: unknown, field: FormlyFieldConfig) => {
            const type = field.formControl?.value;
            const label = types.find((o) => o.type === type)?.label;
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
          return types
            .filter(
              (t) =>
                t.type === field.model?.type ||
                // Rotating only with the stock on a rotary axis, and not
                // inside a rotary repeat.
                (NO_TOOL.has(t.type)
                  ? !inner && onRotary(field)
                  : allowsBit(t.type, bitType)),
            )
            .map((t) => ({ value: t.type, label: t.label }));
        },
      },
    },
    {
      key: 'wrap',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'wrap round the cylinder',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          cutsNothing(field) || !onRoundStock(field),
        'props.description': (field: FormlyFieldConfig) => {
          const stock = rootModel(field)?.stock;
          const across = stock?.rotaryAlong === 'y' ? 'X' : 'Y';
          const r = (numberIn(field, stock?.diameter) ?? 0) / 2;
          return `draw it unrolled: ${across} runs round the stock, the axis line on top, ±${Math.round(Math.PI * r * 10) / 10} mm either side to go all round`;
        },
      },
    },
    ...types.map((t) => t.fieldGroup),
    // Only these ramp into their cuts.
    withHide(
      cutsNothing,
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
    ),
  ];
}

/** What a rotary repeat cuts at each angle: a list of its own. */
const innerList: FormlyFieldConfig = {
  key: 'operations',
  type: 'repeat',
  defaultValue: [],
  props: {
    ...listProps(true),
    label: 'cut at each angle',
  },
  fieldArray: { fieldGroup: operationFields(true) },
};

const rotaryRepeat = rotaryRepeatDefinition(innerList);

export const field: FormlyFieldConfig = {
  key: 'operations',
  type: 'repeat',
  defaultValue: [],
  props: listProps(false),
  fieldArray: { fieldGroup: operationFields(false) },
};

/** `field`, also hidden when `hide` says so. */
function withHide(
  hide: (field: FormlyFieldConfig) => boolean,
  field: FormlyFieldConfig,
): FormlyFieldConfig {
  const own = field.expressions?.['hide'];
  return {
    ...field,
    expressions: {
      ...field.expressions,
      hide: (f: FormlyFieldConfig) =>
        hide(f) || (typeof own === 'function' ? !!own(f) : !!own),
    },
  };
}
