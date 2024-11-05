import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapesModelType, field as shapesField } from './shapes';
import { ModelType as ToolsModelType, field as toolsField } from './tools';
import { OmitUnion } from '../../util';

export type ModelType = ShapesModelType & ToolsModelType;

export type ShapeType = ModelType['shapes'][number];
export type ShapeParameters = OmitUnion<
  ShapeType,
  'id' | 'transforms' | 'expanded' | 'name'
>;
export type TransformType = ShapeType['transforms'][number];
export type TransformParameters = OmitUnion<TransformType, 'id' | 'expanded'>;
export type OperationType =
  ToolsModelType['tools'][number]['operations'][number];
export type OperationParameters = OmitUnion<
  OperationType,
  'id' | 'expanded' | 'name' | 'shapeId'
>;
export type ToolParameters = OmitUnion<
  ToolsModelType['tools'][number],
  'id' | 'expanded' | 'name' | 'operations'
>;
export const ModelFieldConfig: FormlyFieldConfig[] = [shapesField, toolsField];
