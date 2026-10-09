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
  'id' | 'transforms' | 'expanded' | 'name' | 'hidden' | 'clamp'
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
  | 'wrap'
  | keyof ToolOverrides
>;
/** What a tool contributes to toolpath routing (not to G-code text). */
export type ToolParameters = OmitUnion<
  ToolsModelType['tools'][number],
  | 'id'
  | 'expanded'
  | 'name'
  | 'index'
  | 'spindleSpeed'
  | 'feedRate'
  | 'plungeFeedRate'
  | 'fluteLength'
  | 'flutes'
>;
export const ModelFieldConfig: FormlyFieldConfig[] = [
  variablesField,
  shapesField,
  toolsField,
  operationsField,
  stockField,
  gcodeField,
];

/** An empty project, as on a first visit. */
export function emptyModel(): ModelType {
  return {
    variables: [],
    shapes: [],
    tools: [],
    operations: [],
    stock: resolveStock(undefined),
    gcode: resolveGcodeOptions(undefined),
  };
}
