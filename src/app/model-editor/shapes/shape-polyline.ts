import { FormlyFieldConfig } from '@ngx-formly/core';
import { PointItem, pointListField } from '../point-list';

/** Straight lines through typed points: a line, a path or a polygon. */
export interface ModelType {
  type: 'polyline';
  polylinePoints: PointItem[];
  /** Join the last point back to the first. */
  polylineClosed: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    pointListField(
      'polylinePoints',
      {
        description:
          'mm, in order. The preview shows the coordinates under the cursor.',
      },
      [
        { id: 'p0', x: 0, y: 0 },
        { id: 'p1', x: 50, y: 20 },
      ],
    ),
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
