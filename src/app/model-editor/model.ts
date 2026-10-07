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

  const operations: any[] = [
    ...(Array.isArray(stored?.operations) ? stored.operations : []),
    ...nested,
  ];
  const profileTabs = tabsFromProfiles(operations, tools);

  return {
    ...stored,
    // Projects from before variables have none.
    variables: Array.isArray(stored?.variables) ? stored.variables : [],
    shapes: (Array.isArray(stored?.shapes) ? stored.shapes : []).map(
      (shape: any) => withTabs(migrateShape(shape), profileTabs),
    ),
    tools: tools.map(({ operations: _, ...tool }) => tool),
    operations: operations.map(migrateOperation),
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
  if (
    operation?.type === 'profile' &&
    PROFILE_TAB_KEYS.some((k) => k in operation)
  ) {
    const rest = { ...operation };
    PROFILE_TAB_KEYS.forEach((key) => delete rest[key]);
    return rest;
  }
  if (operation?.type !== 'flat' || !('depthPerStep' in operation)) {
    return operation;
  }
  const { depthPerStep, ...rest } = operation;
  return { ...rest, depth: depthPerStep };
}

/** What profiles had for tabs before tabs became the shapes' own. */
const PROFILE_TAB_KEYS = [
  'tabsEnabled',
  'tabCount',
  'tabWidth',
  'tabHeight',
  'tabOffset',
];

/**
 * Profiles used to leave tabs themselves (`tabHeight` above the bottom of
 * the cut); now a shape has them, through a `tabs` transform. For each
 * shape a profile with tabs cut (the first such profile), the transform
 * that leaves the same tabs, by shape id.
 */
function tabsFromProfiles(operations: any[], tools: any[]): Map<string, any> {
  const found = new Map<string, any>();
  for (const op of operations) {
    if (op?.type !== 'profile' || !op.tabsEnabled || !op.shapeId) continue;
    if (found.has(op.shapeId)) continue;
    const diameter = tools.find((t) => t?.id === op.toolId)?.diameter;
    found.set(op.shapeId, {
      id: `tabs-${op.shapeId}`,
      expanded: false,
      disabled: false,
      type: 'tabs',
      tabsOn: op.mode ?? 'both',
      tabSide: op.side === 'on-line' ? 'both' : (op.side ?? 'outside'),
      tabCount: op.tabCount ?? 4,
      tabWidth: op.tabWidth ?? 5,
      tabLength: typeof diameter === 'number' && diameter > 10 ? diameter : 10,
      tabDepth: tabTopDepth(op),
      tabOffset: op.tabOffset ?? 0,
    });
  }
  return found;
}

/**
 * How deep a profile's tabs' top was: the bottom of the cut (start depth
 * and all the steps) less the tab height. A number where they all are,
 * else an expression of them.
 */
function tabTopDepth(op: any): number | string {
  const startDepth = op.startDepth ?? 0;
  const depth = op.depth ?? 0;
  const steps = op.steps ?? 1;
  const height = op.tabHeight ?? 0;
  const total = op.depthMode === 'total';
  if ([startDepth, depth, steps, height].every((v) => typeof v === 'number')) {
    const bottom = startDepth + (total ? depth : depth * steps);
    return Math.max(0, +(bottom - height).toFixed(6));
  }
  const term = (input: number | string) =>
    /^[\w.]+$/.test(String(input).trim())
      ? String(input).trim()
      : `(${String(input).trim()})`;
  const cut = total ? term(depth) : `${term(depth)} * ${term(steps)}`;
  const start = startDepth === 0 ? '' : `${term(startDepth)} + `;
  return `${start}${cut} - ${term(height)}`;
}

/** The shape with the tabs its profiles left (see tabsFromProfiles). */
function withTabs(shape: any, profileTabs: Map<string, any>) {
  const tabs = profileTabs.get(shape?.id);
  const transforms: any[] = Array.isArray(shape?.transforms)
    ? shape.transforms
    : [];
  if (!tabs || transforms.some((t) => t?.type === 'tabs')) {
    return shape;
  }
  return { ...shape, transforms: [...transforms, tabs] };
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
