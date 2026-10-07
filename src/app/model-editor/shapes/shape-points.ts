import { FormlyFieldConfig } from '@ngx-formly/core';
import { PointItem, pointListField } from '../point-list';

/**
 * Points or round holes: a typed list, a grid, or a circle (bolt circle).
 * Points (hole diameter 0) are for drilling; holes can be pocketed, bored
 * or profiled like any circle.
 */
export interface ModelType {
  type: 'points';
  pointsMode: 'list' | 'grid' | 'circle';
  pointsList: PointItem[];
  gridCountX: number;
  gridCountY: number;
  gridSpacingX: number;
  gridSpacingY: number;
  circleCount: number;
  circleDiameter: number;
  circleStartAngle: number;
  /** 0 for points; otherwise a circle of this diameter at each. */
  holeDiameter: number;
}

const hideUnlessPoints = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;
const hideUnlessMode = (mode: ModelType['pointsMode']) => ({
  hide: (field: FormlyFieldConfig) =>
    hideUnlessPoints(field) || field.model?.pointsMode !== mode,
});

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'pointsMode',
      type: 'enum',
      defaultValue: 'grid',
      props: {
        label: 'points',
        required: true,
        options: [
          { value: 'grid', label: 'grid' },
          { value: 'circle', label: 'circle (bolt circle)' },
          { value: 'list', label: 'list of coordinates' },
        ],
      },
    },
    {
      ...pointListField(
        'pointsList',
        {
          description:
            'mm. The preview shows the coordinates under the cursor.',
        },
        [
          { id: 'p0', x: 0, y: 0 },
          { id: 'p1', x: 20, y: 0 },
          { id: 'p2', x: 20, y: 20 },
        ],
      ),
      expressions: {
        // A list's own model is the list: the mode is on its parent's.
        hide: (field: FormlyFieldConfig) =>
          field.parent?.model?.pointsMode !== 'list',
      },
    },
    {
      key: 'gridCountX',
      type: 'number',
      defaultValue: 3,
      props: { label: 'x count', min: 1, required: true },
      validators: { validation: ['whole-number'] },
      expressions: hideUnlessMode('grid'),
    },
    {
      key: 'gridSpacingX',
      type: 'number',
      defaultValue: 20,
      props: { label: 'x spacing', required: true },
      expressions: hideUnlessMode('grid'),
    },
    {
      key: 'gridCountY',
      type: 'number',
      defaultValue: 2,
      props: { label: 'y count', min: 1, required: true },
      validators: { validation: ['whole-number'] },
      expressions: hideUnlessMode('grid'),
    },
    {
      key: 'gridSpacingY',
      type: 'number',
      defaultValue: 20,
      props: { label: 'y spacing', required: true },
      expressions: hideUnlessMode('grid'),
    },
    {
      key: 'circleCount',
      type: 'number',
      defaultValue: 6,
      props: { label: 'count', min: 1, required: true },
      validators: { validation: ['whole-number'] },
      expressions: hideUnlessMode('circle'),
    },
    {
      key: 'circleDiameter',
      type: 'number',
      defaultValue: 50,
      props: {
        label: 'circle diameter',
        description: 'mm, through the points; centred on 0, 0',
        min: 0,
        required: true,
      },
      expressions: hideUnlessMode('circle'),
    },
    {
      key: 'circleStartAngle',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'first at',
        description: '°, counter-clockwise from +X',
        required: true,
      },
      expressions: hideUnlessMode('circle'),
    },
    {
      key: 'holeDiameter',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'hole diameter',
        description: 'mm; 0 for points (drilling)',
        min: 0,
        required: true,
      },
    },
  ],
  expressions: { hide: hideUnlessPoints },
};

export const Definition = {
  type: 'points',
  label: 'points / hole pattern',
  fieldGroup: field,
} as const;
