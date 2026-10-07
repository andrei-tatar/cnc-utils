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
  Definition as AlignDefinition,
  ModelType as AlignModelType,
} from './transform-align';
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
import {
  Definition as OffsetDefinition,
  ModelType as OffsetModelType,
} from './transform-offset';
import {
  Definition as ConvexHullDefinition,
  ModelType as ConvexHullModelType,
} from './transform-convexhull';
import {
  Definition as BoundsDefinition,
  ModelType as BoundsModelType,
} from './transform-bounds';
import {
  Definition as PolarDefinition,
  ModelType as PolarModelType,
} from './transform-polar';
import {
  Definition as DogboneDefinition,
  ModelType as DogboneModelType,
} from './transform-dogbone';
import {
  Definition as CornersDefinition,
  ModelType as CornersModelType,
} from './transform-corners';
import {
  Definition as FitDefinition,
  ModelType as FitModelType,
} from './transform-fit';
import {
  Definition as SimplifyDefinition,
  ModelType as SimplifyModelType,
} from './transform-simplify';
import {
  Definition as MirrorDefinition,
  ModelType as MirrorModelType,
} from './transform-mirror';
import {
  Definition as CentersDefinition,
  ModelType as CentersModelType,
} from './transform-centers';
import {
  Definition as TabsDefinition,
  ModelType as TabsModelType,
} from './transform-tabs';

export type ModelType = {
  transforms: Array<
    (
      | RepeatModelType
      | TranslateModelType
      | AlignModelType
      | RotateModelType
      | ScaleModelType
      | FlipModelType
      | OffsetModelType
      | ConvexHullModelType
      | BoundsModelType
      | PolarModelType
      | DogboneModelType
      | CornersModelType
      | FitModelType
      | SimplifyModelType
      | MirrorModelType
      | CentersModelType
      | TabsModelType
    ) & {
      id: string;
      expanded: boolean;
      /** Skipped: the shape passes through unchanged. */
      disabled?: boolean;
    }
  >;
};

const transforms = [
  TranslateDefinition,
  AlignDefinition,
  RotateDefinition,
  ScaleDefinition,
  FitDefinition,
  FlipDefinition,
  MirrorDefinition,
  RepeatDefinition,
  PolarDefinition,
  OffsetDefinition,
  CornersDefinition,
  DogboneDefinition,
  SimplifyDefinition,
  ConvexHullDefinition,
  BoundsDefinition,
  CentersDefinition,
  TabsDefinition,
];

export const field: FormlyFieldConfig = {
  key: 'transforms',
  type: 'repeat',
  props: {
    label: 'transforms',
    itemLabel: 'transform',
    accent: '#7c3aed',
    toggle: {
      key: 'disabled',
      icon: 'switch',
      onTitle: 'Disable: pass the shape through unchanged',
      offTitle: 'Disabled — click to apply this transform again',
    },
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'disabled',
        type: 'hidden',
        defaultValue: false,
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
