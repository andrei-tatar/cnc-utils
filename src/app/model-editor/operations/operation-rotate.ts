import { FormlyFieldConfig } from '@ngx-formly/core';
import { sideUp } from '../../../cam/rotary';
import { rootModel } from '../shapes/describe';
import { numberIn } from '../variables/field';

/**
 * Turns the stock on the rotary axis to `angle` for the operations below it,
 * up to the next rotate (see `operationRotation`). Cuts nothing itself: no
 * tool or shape.
 */
export interface ModelType {
  type?: 'rotate';
  /** Degrees, by the right-hand rule round the axis (see rotary.ts). */
  angle: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'angle',
      type: 'number',
      defaultValue: 90,
      props: { label: 'turn to', required: true },
      expressions: {
        'props.description': (field: FormlyFieldConfig) => {
          const angle = numberIn(field, field.model?.angle);
          const along =
            rootModel(field)?.stock?.rotaryAlong === 'y' ? 'y' : 'x';
          const side = angle === undefined ? null : sideUp(along, angle);
          return `degrees the rotary axis turns the stock to, for the operations below${
            side ? `: ${side}` : ''
          }`;
        },
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'rotate',
  label: 'rotate (4th axis)',
  fieldGroup: field,
} as const;
