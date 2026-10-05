import { FormlyFieldConfig } from '@ngx-formly/core';
import { allShapes, describeShape } from './describe';
import {
  field as transformsField,
  ModelType as TransformsModelType,
} from '../transforms';

import {
  Definition as CircleDefinition,
  ModelType as CircleModelType,
} from './shape-circle';
import {
  Definition as RectangleDefinition,
  ModelType as RectangleModelType,
} from './shape-rectangle';
import {
  Definition as SvgDefinition,
  ModelType as SvgModelType,
} from './shape-svg';
import {
  Definition as LineDefinition,
  ModelType as LineModelType,
} from './shape-line';
import {
  Definition as PathDataDefinition,
  ModelType as PathDataModelType,
} from './shape-pathdata';
import {
  Definition as BooleanDefinition,
  ModelType as BooleanModelType,
} from './shape-boolean';

type CommonShape = {
  id: string;
  name?: string;
  expanded: boolean;
} & TransformsModelType;

type ShapeType =
  | CircleModelType
  | RectangleModelType
  | SvgModelType
  | LineModelType
  | PathDataModelType
  | BooleanModelType;

export type ModelType = {
  shapes: Array<ShapeType & CommonShape>;
};

const shapes = [
  CircleDefinition,
  RectangleDefinition,
  SvgDefinition,
  LineDefinition,
  PathDataDefinition,
  BooleanDefinition,
];

export const field: FormlyFieldConfig = {
  key: 'shapes',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'shapes',
    itemLabel: 'shape',
    describeItem: (shape: any, field: FormlyFieldConfig) =>
      describeShape(shape, allShapes(field)),
    accent: '#2563eb',
    collapsible: true,
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeShape(field.model, allShapes(field)),
        },
      },
      {
        key: 'expanded',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'type',
        type: 'enum',
        props: {
          label: 'type',
          required: true,
          options: shapes.map((t) => ({ value: t.type, label: t.label })),
        },
      },
      ...shapes.map((t) => t.fieldGroup),
      transformsField,
    ],
  },
};
