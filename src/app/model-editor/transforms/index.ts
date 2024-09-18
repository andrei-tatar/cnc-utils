import { FormlyFieldConfig } from '@ngx-formly/core';

import {
  Definition as RepeatDefinition,
  ModelType as RepeatModelType,
} from './transform-repeat';
import {
  Definition as TranslateDefinition,
  ModelType as TranslateModelType,
} from './transform-translate';
import {
  Definition as RotateDefinition,
  ModelType as RotateModelType,
} from './transform-rotate';
import {
  Definition as ScaleDefinition,
  ModelType as ScaleModelType,
} from './transform-scale';
import {
  Definition as FlipDefinition,
  ModelType as FlipModelType,
} from './transform-flip';

export type ModelType = {
  transforms: Array<
    (
      | RepeatModelType
      | TranslateModelType
      | RotateModelType
      | ScaleModelType
      | FlipModelType
    ) & {
      id: string;
      expanded: boolean;
    }
  >;
};

const transforms = [
  RepeatDefinition,
  TranslateDefinition,
  RotateDefinition,
  ScaleDefinition,
  FlipDefinition,
];

export const field: FormlyFieldConfig = {
  key: 'transforms',
  type: 'repeat',
  props: {
    label: 'transforms',
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
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
          options: transforms.map((t) => ({ value: t.type, label: t.label })),
        },
      },
      ...transforms.map((t) => t.fieldGroup),
    ],
  },
};
