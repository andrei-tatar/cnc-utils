import { FormlyFieldConfig } from '@ngx-formly/core';
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

type CommonShape = {
  id: string;
  name: string;
} & TransformsModelType;

type ShapeType = CircleModelType | RectangleModelType | SvgModelType;

export type ModelType = {
  shapes: Array<ShapeType & CommonShape>;
};

const shapes = [CircleDefinition, RectangleDefinition, SvgDefinition];

export const field: FormlyFieldConfig = {
  key: 'shapes',
  type: 'repeat',
  defaultValue: [],

  props: {
    label: 'shapes',
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
          required: true,
        },
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
