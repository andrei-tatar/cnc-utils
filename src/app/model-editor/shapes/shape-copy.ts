import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, shapeLabel } from './describe';

/**
 * Another shape's result (after its own transforms), for this shape's
 * transforms to work on: a transformed version next to the original,
 * without copying its settings, so it follows any change to it.
 */
export interface ModelType {
  type: 'copy';
  copyOfId: string;
}

/** The shapes `shape` takes its geometry from (copies and booleans). */
function sources(shape: any): string[] {
  switch (shape?.type) {
    case 'copy':
      return [shape.copyOfId];
    case 'boolean':
      return [shape.shape1Id, shape.shape2Id];
    default:
      return [];
  }
}

/** Whether `fromId` takes its geometry from `id`, directly or not. */
function dependsOn(fromId: string, id: string, shapes: any[]): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === id) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    stack.push(...sources(shapes.find((s) => s.id === current)));
  }
  return false;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'copyOfId',
      type: 'enum',
      props: {
        label: 'copy of',
        required: true,
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
            !dependsOn(control.value, field.model?.id, allShapes(field)),
          message: 'That shape takes its geometry from this one — pick another',
        },
      },
      expressions: {
        'props.options': (field: FormlyFieldConfig) => {
          const shapes = allShapes(field);
          return shapes
            .filter((shape) => !dependsOn(shape.id!, field.model?.id, shapes))
            .map((shape) => ({
              value: shape.id,
              label: shapeLabel(shape, shapes),
            }));
        },
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'copy',
  label: 'copy of a shape',
  fieldGroup: field,
} as const;
