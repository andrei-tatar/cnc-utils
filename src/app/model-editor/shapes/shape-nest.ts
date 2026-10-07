import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, dependsOn, shapeLabel } from './describe';

/** A part to lay out on the sheet: copies of another shape. */
export interface NestItem {
  id?: string;
  shapeId: string;
  count: number;
  /** May be turned 90° (else its grain runs the way it's drawn). */
  rotate: boolean;
}

/**
 * Parts laid out on a sheet (plywood, MDF): copies of other shapes packed
 * by their bounding boxes, a gap apart and clear of the sheet's edges. The
 * sheet's bottom-left corner is at 0, 0. Parts that don't fit go on further
 * sheets: pick which one this shape shows.
 */
export interface ModelType {
  type: 'nest';
  nestItems: NestItem[];
  nestSheetWidth: number;
  nestSheetHeight: number;
  nestMargin: number;
  nestGap: number;
  /** Which sheet to show and cut, from 1. */
  nestSheet: number;
}

/** The nest shape a field belongs to. */
function owningShape(field: FormlyFieldConfig): any {
  let current = field.parent;
  while (current && current.model?.type !== 'nest') {
    current = current.parent;
  }
  return current?.model;
}

/** A pick of another shape, for lists in nests (not this one or its users). */
export function shapePicker(
  owner: (field: FormlyFieldConfig) => any,
  extra: Partial<FormlyFieldConfig> = {},
): FormlyFieldConfig {
  return {
    key: 'shapeId',
    type: 'enum',
    props: {
      required: true,
      placeholder: 'shape',
      attributes: { 'aria-label': 'shape' },
    },
    validators: {
      shapeExists: {
        expression: (control: AbstractControl, field: FormlyFieldConfig) =>
          !control.value ||
          allShapes(field).some((s) => s.id === control.value),
        message: 'This shape was deleted — pick another one',
      },
      noLoop: {
        expression: (control: AbstractControl, field: FormlyFieldConfig) =>
          !control.value ||
          !dependsOn(control.value, owner(field)?.id, allShapes(field)),
        message: 'That shape takes its geometry from this one — pick another',
      },
    },
    expressions: {
      'props.options': (field: FormlyFieldConfig) => {
        const shapes = allShapes(field);
        const ownId = owner(field)?.id;
        return shapes
          .filter((shape) => !dependsOn(shape.id!, ownId, shapes))
          .map((shape) => ({
            value: shape.id,
            label: shapeLabel(shape, shapes),
          }));
      },
    },
    ...extra,
  };
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'nestItems',
      type: 'repeat',
      defaultValue: [{}],
      props: {
        label: 'parts',
        itemLabel: 'part',
        inline: true,
        description:
          'Each a shape (after its transforms), how many, and whether it may turn 90° (leave off to keep the grain).',
      },
      fieldArray: {
        fieldGroupClassName: 'nest-row',
        fieldGroup: [
          { key: 'id', type: 'hidden', className: 'd-none' },
          shapePicker(owningShape, { className: 'nest-shape' }),
          {
            key: 'count',
            type: 'number',
            className: 'nest-count',
            defaultValue: 1,
            props: {
              required: true,
              min: 0,
              attributes: { 'aria-label': 'how many' },
              placeholder: 'count',
            },
            validators: { validation: ['whole-number'] },
          },
          {
            key: 'rotate',
            type: 'boolean',
            className: 'nest-rotate',
            defaultValue: true,
            props: { label: 'may turn' },
          },
        ],
      },
    },
    {
      key: 'nestSheetWidth',
      type: 'number',
      defaultValue: 2440,
      props: {
        label: 'sheet width',
        description: 'mm, along X',
        min: 0,
        required: true,
      },
    },
    {
      key: 'nestSheetHeight',
      type: 'number',
      defaultValue: 1220,
      props: {
        label: 'sheet height',
        description: 'mm, along Y',
        min: 0,
        required: true,
      },
    },
    {
      key: 'nestMargin',
      type: 'number',
      defaultValue: 10,
      props: {
        label: 'margin',
        description: 'mm kept clear along the sheet’s edges',
        min: 0,
        required: true,
      },
    },
    {
      key: 'nestGap',
      type: 'number',
      defaultValue: 10,
      props: {
        label: 'gap',
        description: 'mm between parts: at least the cutting bit’s diameter',
        min: 0,
        required: true,
      },
    },
    {
      key: 'nestSheet',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'sheet',
        description:
          'which sheet to show and cut, when the parts need more than one',
        min: 1,
        required: true,
      },
      validators: { validation: ['whole-number'] },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'nest',
  label: 'nest parts on a sheet',
  fieldGroup: field,
} as const;
