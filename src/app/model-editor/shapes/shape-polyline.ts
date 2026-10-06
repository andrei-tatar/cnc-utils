import { FormlyFieldConfig } from '@ngx-formly/core';

/** Straight lines through typed points: a line, a path or a polygon. */
export interface ModelType {
  type: 'polyline';
  /** One "x, y" per line. */
  polylinePoints: string;
  /** Join the last point back to the first. */
  polylineClosed: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'polylinePoints',
      type: 'textarea',
      defaultValue: '0, 0\n50, 20',
      props: {
        label: 'x, y',
        description: 'one point per line, in mm',
        rows: 5,
        required: true,
      },
    },
    {
      key: 'polylineClosed',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'closed (back to the first point)' },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'polyline',
  label: 'lines through points',
  fieldGroup: field,
} as const;
