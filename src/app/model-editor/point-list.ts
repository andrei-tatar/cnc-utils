import { FormlyFieldConfig, FormlyFieldProps } from '@ngx-formly/core';

/** A point in a typed list: x and y each a number or an expression. */
export interface PointItem {
  id: string;
  x: number;
  y: number;
}

/**
 * A list of points edited inline, one row per point: x and y as number
 * fields, so each can use variables. A list's own model is the list, so
 * hide expressions on it read its parent's (`field.parent.model`).
 */
export function pointListField(
  key: string,
  props: FormlyFieldProps,
  defaultValue: PointItem[] = [],
): FormlyFieldConfig {
  return {
    key,
    type: 'repeat',
    defaultValue,
    props: {
      label: 'points',
      itemLabel: 'point',
      inline: true,
      ...props,
    },
    fieldArray: {
      fieldGroupClassName: 'point-row',
      fieldGroup: [
        {
          key: 'id',
          type: 'hidden',
          className: 'd-none',
        },
        {
          key: 'x',
          type: 'number',
          className: 'point-x',
          defaultValue: 0,
          props: {
            placeholder: 'x',
            required: true,
            attributes: { 'aria-label': 'x' },
          },
        },
        {
          key: 'y',
          type: 'number',
          className: 'point-y',
          defaultValue: 0,
          props: {
            placeholder: 'y',
            required: true,
            attributes: { 'aria-label': 'y' },
          },
        },
      ],
    },
  };
}
