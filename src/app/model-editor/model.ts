import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapesModelType, field as shapesField } from './shapes';
import { ModelType as ToolsModelType, field as toolsField } from './tools';

export type ModelType = ShapesModelType & ToolsModelType;

export const ModelFieldConfig: FormlyFieldConfig[] = [shapesField, toolsField];
