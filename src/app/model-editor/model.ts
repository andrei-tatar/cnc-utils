import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapesModelType, field as shapesField } from './shapes';
import { ModelType as ToolsModelType, field as toolsField } from './tools';
import {
  ModelType as OperationsModelType,
  field as operationsField,
} from './operations';
import { ModelType as GcodeModelType, field as gcodeField } from './gcode';
import { ModelType as StockModelType, field as stockField } from './stock';
import {
  ModelType as VariablesModelType,
  field as variablesField,
} from './variables';
import { resolveStock } from '../../cam/stock';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { OmitUnion } from '../../util';
import { ToolOverrides } from './tools/feeds-and-speeds';

export type ModelType = VariablesModelType &
  ShapesModelType &
  ToolsModelType &
  OperationsModelType &
  StockModelType &
  GcodeModelType;

export type ShapeType = ModelType['shapes'][number];
export type ShapeParameters = OmitUnion<
  ShapeType,
  'id' | 'transforms' | 'expanded' | 'name' | 'hidden'
>;
export type TransformType = ShapeType['transforms'][number];
export type TransformParameters = OmitUnion<
  TransformType,
  'id' | 'expanded' | 'disabled'
>;
export type OperationType = OperationsModelType['operations'][number];
export type OperationParameters = OmitUnion<
  OperationType,
  | 'id'
  | 'expanded'
  | 'name'
  | 'shapeId'
  | 'toolId'
  | 'disabled'
  | keyof ToolOverrides
>;
/** What a tool contributes to toolpath routing (not to G-code text). */
export type ToolParameters = OmitUnion<
  ToolsModelType['tools'][number],
  'id' | 'expanded' | 'name' | 'spindleSpeed' | 'feedRate' | 'plungeFeedRate'
>;
export const ModelFieldConfig: FormlyFieldConfig[] = [
  variablesField,
  shapesField,
  toolsField,
  operationsField,
  stockField,
  gcodeField,
];

/**
 * Bring a stored model (localStorage, or the metadata embedded in a .nc
 * file) up to the current shape. Projects saved before operations became
 * their own section kept them nested in each tool: move them out, in tool
 * order, linking each to its tool. Transforms that were replaced are
 * converted to what replaced them.
 */
export function migrateModel(stored: any): ModelType {
  const tools: any[] = Array.isArray(stored?.tools) ? stored.tools : [];
  const nested = tools.flatMap((tool) =>
    (Array.isArray(tool.operations) ? tool.operations : []).map(
      (operation: any) => ({ ...operation, toolId: tool.id }),
    ),
  );

  return {
    ...stored,
    // Projects from before variables have none.
    variables: Array.isArray(stored?.variables) ? stored.variables : [],
    shapes: (Array.isArray(stored?.shapes) ? stored.shapes : []).map(
      migrateShape,
    ),
    tools: tools.map(({ operations: _, ...tool }) => tool),
    operations: [
      ...(Array.isArray(stored?.operations) ? stored.operations : []),
      ...nested,
    ].map(migrateOperation),
    // Projects from before G-code options existed get the defaults.
    gcode: resolveGcodeOptions(stored?.gcode),
    // Projects from before stock settings have none set.
    stock: resolveStock(stored?.stock),
  };
}

/**
 * Flat surfacing kept its depth per step as `depthPerStep`; it now has the
 * same depth settings as pockets and profiles (`depth`, read per step).
 */
function migrateOperation(operation: any) {
  if (operation?.type !== 'flat' || !('depthPerStep' in operation)) {
    return operation;
  }
  const { depthPerStep, ...rest } = operation;
  return { ...rest, depth: depthPerStep };
}

function migrateShape(shape: any) {
  shape = migrateBoolean(shape);
  if (!Array.isArray(shape?.transforms)) {
    return shape;
  }
  return {
    ...shape,
    transforms: shape.transforms.map((transform: any) =>
      transform?.type === 'onetime'
        ? // The old fixed "onetime" transform: a 21 mm circle at the centre
          // of every polygon, added to the shape.
          {
            id: transform.id,
            expanded: transform.expanded,
            disabled: transform.disabled,
            type: 'centers',
            centersRadius: 21,
            centersOf: 'all',
            centersKeepOriginal: true,
          }
        : transform,
    ),
  };
}

/**
 * Booleans used to combine exactly two shapes (`shape1Id` `operationType`
 * `shape2Id`); now they take a list, each shape after the first with its
 * own operation.
 */
function migrateBoolean(shape: any) {
  if (shape?.type !== 'boolean' || Array.isArray(shape.operands)) {
    return shape;
  }
  const { shape1Id, shape2Id, operationType, ...rest } = shape;
  return {
    ...rest,
    operands: [
      { shapeId: shape1Id },
      { shapeId: shape2Id, operation: operationType ?? 'intersection' },
    ],
  };
}
