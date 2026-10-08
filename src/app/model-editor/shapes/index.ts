import { FormlyFieldConfig } from '@ngx-formly/core';
import type { ItemAction } from '../components/array-type-component';
import { ShapeExporter } from './shape-export';
import { resolvedModelOf } from '../variables/field';
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
import {
  Definition as CopyDefinition,
  ModelType as CopyModelType,
} from './shape-copy';
import {
  Definition as TextDefinition,
  ModelType as TextModelType,
} from './shape-text';
import {
  Definition as PointsDefinition,
  ModelType as PointsModelType,
} from './shape-points';
import {
  Definition as SlotDefinition,
  ModelType as SlotModelType,
} from './shape-slot';
import {
  Definition as PolylineDefinition,
  ModelType as PolylineModelType,
} from './shape-polyline';
import {
  Definition as BoxPanelDefinition,
  ModelType as BoxPanelModelType,
} from './shape-box-panel';
import {
  Definition as TraceDefinition,
  ModelType as TraceModelType,
} from './shape-trace';
import {
  Definition as HingeCupDefinition,
  ModelType as HingeCupModelType,
} from './shape-hinge-cup';
import {
  Definition as BowtieDefinition,
  ModelType as BowtieModelType,
} from './shape-bowtie';
import {
  Definition as NestDefinition,
  ModelType as NestModelType,
} from './shape-nest';
import {
  Definition as NestLayerDefinition,
  ModelType as NestLayerModelType,
} from './shape-nest-layer';

type CommonShape = {
  id: string;
  name?: string;
  expanded: boolean;
  /** Not drawn in the preview (still usable by operations and booleans). */
  hidden?: boolean;
  /**
   * A clamp or other zone to keep the bit away from: drawn in red, and
   * cuts that come within reach of it are flagged.
   */
  clamp?: boolean;
} & TransformsModelType;

type ShapeType =
  | CircleModelType
  | RectangleModelType
  | SvgModelType
  | LineModelType
  | PathDataModelType
  | BooleanModelType
  | CopyModelType
  | TextModelType
  | PointsModelType
  | SlotModelType
  | PolylineModelType
  | BoxPanelModelType
  | TraceModelType
  | HingeCupModelType
  | BowtieModelType
  | NestModelType
  | NestLayerModelType;

export type ModelType = {
  shapes: Array<ShapeType & CommonShape>;
};

const shapes = [
  CircleDefinition,
  RectangleDefinition,
  SlotDefinition,
  PointsDefinition,
  LineDefinition,
  PolylineDefinition,
  PathDataDefinition,
  SvgDefinition,
  TraceDefinition,
  TextDefinition,
  BoxPanelDefinition,
  HingeCupDefinition,
  BowtieDefinition,
  BooleanDefinition,
  CopyDefinition,
  NestDefinition,
  NestLayerDefinition,
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
    clonable: true,
    toggle: {
      key: 'hidden',
      icon: 'eye',
      onTitle: 'Hide in the preview',
      offTitle: 'Hidden in the preview — click to show',
    },
    itemActions: [
      {
        title: 'Export as SVG (mm), e.g. for a laser cutter',
        icon: 'M8 2.5v7.5M4.8 6.8 8 10l3.2-3.2M2.5 11v2.5h11V11',
        run({ injector, item, name }) {
          injector.get(ShapeExporter).exportShapeSvg(item.id, name);
        },
      } satisfies ItemAction,
    ],
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'hidden',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeShape(resolvedModelOf(field), allShapes(field)),
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
      {
        key: 'clamp',
        type: 'boolean',
        defaultValue: false,
        props: {
          label: 'clamp / keep-out zone: flag cuts that come within reach',
        },
      },
      transformsField,
    ],
  },
};
