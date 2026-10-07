/**
 * Building blocks shared by the shapes-* and transforms-* fixtures: tools,
 * operations and terse shape / transform constructors. Not a fixture file
 * itself (its default export is empty, so a loader globbing this folder
 * finds no fixtures here).
 */
import type { Fixture } from './fixture';
import type {
  ModelType,
  ShapeType,
  TransformType,
} from '../../../src/app/model-editor/model';
import type { ToolType } from '../../../src/app/model-editor/tools';
import type { OmitUnion } from '../../../src/util';
import type { ModelType as ProfileModelType } from '../../../src/app/model-editor/operations/operation-profile';
import type { ModelType as PocketModelType } from '../../../src/app/model-editor/operations/operation-pocket';
import type { ModelType as DrillModelType } from '../../../src/app/model-editor/operations/operation-drill';
import type { FontRef } from '../../../src/cam/font-source';

export type Operation = ModelType['operations'][number];
export type ShapeFields = OmitUnion<
  ShapeType,
  'id' | 'expanded' | 'transforms'
>;
type TransformFields = OmitUnion<TransformType, 'id' | 'expanded'>;

/**
 * A shape with an id, its transforms in order. Transform ids get the
 * shape's id in front, so ids stay unique across the project (as the
 * templates' spec asks).
 */
export function shape(
  id: string,
  fields: ShapeFields,
  transforms: TransformType[] = [],
): ShapeType {
  return {
    id,
    expanded: false,
    ...fields,
    transforms: transforms.map((t) => ({ ...t, id: `${id}-${t.id}` })),
  } as ShapeType;
}

/** A transform with an id. */
export function tf(id: string, fields: TransformFields): TransformType {
  return { id, expanded: false, ...fields } as TransformType;
}

/** A number field holding an expression (the model keeps it as typed). */
export function expr(expression: string): number {
  return expression as unknown as number;
}

/** T1: a 6 mm two-flute end mill. */
export const endMill6: ToolType = {
  id: 'em6',
  name: '6 mm end mill',
  expanded: false,
  index: 1,
  bitType: 'end-mill',
  diameter: 6,
  vAngle: 90,
  tipDiameter: 0,
  fluteLength: 22,
  feedRate: 1200,
  plungeFeedRate: 300,
  spindleSpeed: 18000,
  ramp: false,
  rampAngle: 3,
};

/** T3: a 2 mm end mill, for detail (text) that the 6 mm one can't reach. */
export const endMill2: ToolType = {
  ...endMill6,
  id: 'em2',
  name: '2 mm end mill',
  index: 3,
  diameter: 2,
  fluteLength: 8,
  feedRate: 800,
  plungeFeedRate: 200,
};

/** T2: a 5 mm twist drill. */
export const drill5: ToolType = {
  id: 'dr5',
  name: '5 mm drill',
  expanded: false,
  index: 2,
  bitType: 'drill',
  diameter: 5,
  vAngle: 90,
  tipDiameter: 0,
  pointAngle: 118,
  fluteLength: 40,
  feedRate: 600,
  plungeFeedRate: 200,
  spindleSpeed: 12000,
};

/** An outside profile, 3 steps of 2 mm (6 mm deep), climb. */
export function profile(
  id: string,
  shapeId: string,
  fields: Partial<ProfileModelType> = {},
  toolId = endMill6.id,
): Operation {
  return {
    id,
    expanded: false,
    toolId,
    shapeId,
    type: 'profile',
    mode: 'both',
    side: 'outside',
    direction: 'climb',
    leaveStock: 0,
    finishPass: false,
    onionSkin: 0,
    leadIn: 0,
    startDepth: 0,
    depthMode: 'per-step',
    depth: 2,
    steps: 3,
    ...fields,
  };
}

/** An offset pocket, 4 mm deep in 2 steps (as a total). */
export function pocket(
  id: string,
  shapeId: string,
  fields: Partial<PocketModelType> = {},
  toolId = endMill6.id,
): Operation {
  return {
    id,
    expanded: false,
    toolId,
    shapeId,
    type: 'pocket',
    strategy: 'offset',
    startDepth: 0,
    depthMode: 'total',
    depth: 4,
    steps: 2,
    leaveStock: 0,
    toolEngagement: 0.4,
    alongAxis: 'y',
    allPassesInSameDirection: false,
    ...fields,
  };
}

/** Drilling with the 5 mm drill, 8 mm deep, plain moves. */
export function drill(
  id: string,
  shapeId: string,
  fields: Partial<DrillModelType> = {},
  toolId = drill5.id,
): Operation {
  return {
    id,
    expanded: false,
    toolId,
    shapeId,
    type: 'drill',
    drillAt: 'centers',
    startDepth: 0,
    depth: 8,
    peck: 0,
    chipBreak: false,
    dwell: 0,
    retractHeight: 1,
    fullDiameter: false,
    output: 'moves',
    ...fields,
  };
}

/** Roboto from Fontsource, pinned. */
export const roboto: FontRef = {
  id: 'roboto',
  family: 'Roboto',
  version: '5.2.10',
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ['italic', 'normal'],
};

/** A rectangle shape's fields. */
export const rect = (width: number, height: number, radius = 0) =>
  ({ type: 'rectangle', width, height, radius }) as const;

/** A circle shape's fields. */
export const circle = (diameter: number) =>
  ({ type: 'circle', diameter }) as const;

/** A closed polyline's fields, from [x, y] pairs. */
export const polygon = (
  points: Array<[number, number]>,
  closed = true,
): ShapeFields => ({
  type: 'polyline',
  polylinePoints: points.map(([x, y], i) => ({ id: `p${i}`, x, y })),
  polylineClosed: closed,
});

/**
 * A closed shape with concave corners and a hole: an L-shaped outline
 * (60 × 50, the notch 30 × 25 out of the top right) with a 10 mm square
 * hole, as path data.
 */
export const lWithHole = {
  type: 'path-data',
  pathCommands: [
    { id: 'c0', command: 'M', x: 0, y: 0 },
    { id: 'c1', command: 'H', x: 60 },
    { id: 'c2', command: 'V', y: 25 },
    { id: 'c3', command: 'H', x: 30 },
    { id: 'c4', command: 'V', y: 50 },
    { id: 'c5', command: 'H', x: 0 },
    { id: 'c6', command: 'Z' },
    { id: 'c7', command: 'M', x: 8, y: 8 },
    { id: 'c8', command: 'v', y: 10 },
    { id: 'c9', command: 'h', x: 10 },
    { id: 'c10', command: 'v', y: -10 },
    { id: 'c11', command: 'Z' },
  ],
} satisfies ShapeFields;

export default [] satisfies Fixture[];
