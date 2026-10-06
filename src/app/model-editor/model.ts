import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelType as ShapesModelType, field as shapesField } from './shapes';
import { ModelType as ToolsModelType, field as toolsField } from './tools';
import {
  ModelType as OperationsModelType,
  field as operationsField,
} from './operations';
import { ModelType as GcodeModelType, field as gcodeField } from './gcode';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { OmitUnion } from '../../util';
import { ToolOverrides } from './tools/feeds-and-speeds';

export type ModelType = ShapesModelType &
  ToolsModelType &
  OperationsModelType &
  GcodeModelType;

export type ShapeType = ModelType['shapes'][number];
export type ShapeParameters = OmitUnion<
  ShapeType,
  'id' | 'transforms' | 'expanded' | 'name' | 'hidden'
>;
export type TransformType = ShapeType['transforms'][number];
export type TransformParameters = OmitUnion<TransformType, 'id' | 'expanded'>;
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
  shapesField,
  toolsField,
  operationsField,
  gcodeField,
];

/**
 * Bring a stored model (localStorage, or the metadata embedded in a .nc
 * file) up to the current shape. Projects saved before operations became
 * their own section kept them nested in each tool: move them out, in tool
 * order, linking each to its tool.
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
    shapes: Array.isArray(stored?.shapes) ? stored.shapes : [],
    tools: tools.map(({ operations: _, ...tool }) => tool),
    operations: [
      ...(Array.isArray(stored?.operations) ? stored.operations : []),
      ...nested,
    ],
    // Projects from before G-code options existed get the defaults.
    gcode: resolveGcodeOptions(stored?.gcode),
  };
}
