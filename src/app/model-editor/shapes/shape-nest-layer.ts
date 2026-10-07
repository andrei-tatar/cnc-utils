import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, dependsOn, shapeLabel } from './describe';
import { shapePicker } from './shape-nest';

/** A shape that goes with a part: placed wherever the part is. */
export interface NestLayerItem {
  id?: string;
  /** The part (one of the nest's shapes). */
  partShapeId: string;
  /** What goes with it (a dado, a pocket, holes), drawn where the part is. */
  shapeId: string;
}

/**
 * Shapes that go with a nest's parts — dados, pockets, holes — moved and
 * turned with each copy of their part, for operations other than the
 * cut-out. Draw them where the part is drawn.
 */
export interface ModelType {
  type: 'nest-layer';
  nestOfId: string;
  nestLayers: NestLayerItem[];
}

function owningShape(field: FormlyFieldConfig): any {
  let current = field.parent;
  while (current && current.model?.type !== 'nest-layer') {
    current = current.parent;
  }
  return current?.model;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'nestOfId',
      type: 'enum',
      props: { label: 'nest', required: true },
      validators: {
        isNest: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allShapes(field).some(
              (s) => s.id === control.value && s.type === 'nest',
            ),
          message: 'This nest was deleted — pick another one',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const shapes = allShapes(field);
          return shapes
            .filter(
              (s) =>
                s.type === 'nest' && !dependsOn(s.id!, field.model?.id, shapes),
            )
            .map((s) => ({ value: s.id, label: shapeLabel(s, shapes) }));
        },
      },
    },
    {
      key: 'nestLayers',
      type: 'repeat',
      defaultValue: [{}],
      props: {
        label: 'with',
        itemLabel: 'shape',
        inline: true,
        description:
          'For each part, the shape that goes with it, placed wherever the part is.',
      },
      fieldArray: {
        fieldGroupClassName: 'nest-row',
        fieldGroup: [
          { key: 'id', type: 'hidden', className: 'd-none' },
          {
            key: 'partShapeId',
            type: 'enum',
            className: 'nest-shape',
            props: {
              required: true,
              placeholder: 'part',
              attributes: { 'aria-label': 'part' },
            },
            expressions: {
              'props.options': (field: FormlyFieldConfig) => {
                const shapes = allShapes(field);
                const nest = shapes.find(
                  (s) => s.id === owningShape(field)?.nestOfId,
                );
                return ((nest?.['nestItems'] as any[]) ?? [])
                  .map((item) => shapes.find((s) => s.id === item?.shapeId))
                  .filter(Boolean)
                  .map((s) => ({ value: s!.id, label: shapeLabel(s, shapes) }));
              },
            },
          },
          shapePicker(owningShape, { className: 'nest-shape' }),
        ],
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'nest-layer',
  label: 'with a nest’s parts',
  fieldGroup: field,
} as const;
