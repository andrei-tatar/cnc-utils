import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapesModelType, field as shapesField } from './shapes';
import { ModelType as ToolsModelType, field as toolsField } from './tools';
import { OmitUnion } from '../../util';

export type ModelType = ShapesModelType & ToolsModelType;

export type ShapeType = ModelType['shapes'][number];
export type ShapeParameters = OmitUnion<
  ShapeType,
  'id' | 'transforms' | 'expanded'
>;
export type TransformType = ShapeType['transforms'][number];
export type TransformParameters = OmitUnion<TransformType, 'id' | 'expanded'>;

export const ModelFieldConfig: FormlyFieldConfig[] = [shapesField, toolsField];
