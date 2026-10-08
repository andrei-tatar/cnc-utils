/**
 * Building blocks for the operations-* fixtures: shapes, tools and one
 * constructor per operation type with every field set explicitly (the
 * Formly defaults, unless a fixture says otherwise). Not a fixture file
 * itself: its default export is empty.
 */
import type { Fixture } from './fixture';
import type { ModelType } from '../../../src/app/model-editor/model';
import type { PathCommand } from '../../../src/cam/path-commands';
import type { FontRef } from '../../../src/cam/font-source';

export type Shape = ModelType['shapes'][number];
export type Transform = Shape['transforms'][number];
export type Tool = ModelType['tools'][number];
export type Operation = ModelType['operations'][number];
type Op<T extends string> = Extract<Operation, { type?: T }>;
/** An operation's own fields (and overrides), all optional. */
export type Fields<T extends string> = Partial<
  Omit<Op<T>, 'id' | 'expanded' | 'toolId' | 'shapeId' | 'type'>
>;

// ------------------------------------------------------------------ shapes

export const ROBOTO: FontRef = {
  id: 'roboto',
  family: 'Roboto',
  version: '5.2.10',
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ['italic', 'normal'],
};

/** A rectangle from (0, 0) to (width, height). */
export function rect(
  id: string,
  width: number,
  height: number,
  radius = 0,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'rectangle',
    width,
    height,
    radius,
    transforms,
  };
}

/** A circle round (0, 0). */
export function circle(
  id: string,
  diameter: number,
  transforms: Transform[] = [],
): Shape {
  return { id, expanded: false, type: 'circle', diameter, transforms };
}

export function polyline(
  id: string,
  points: Array<[number, number]>,
  closed: boolean,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'polyline',
    polylinePoints: points.map(([x, y], i) => ({ id: `${id}-p${i}`, x, y })),
    polylineClosed: closed,
    transforms,
  };
}

export function pathData(
  id: string,
  commands: PathCommand[],
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'path-data',
    pathCommands: commands.map((c, i) => ({ id: `${id}-c${i}`, ...c })),
    transforms,
  };
}

/** Roboto text, `size` the capital height (mm). */
export function text(
  id: string,
  value: string,
  size: number,
  fontWeight = 400,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'text',
    text: value,
    font: ROBOTO,
    fontWeight,
    fontStyle: 'normal',
    size,
    letterSpacing: 0,
    lineSpacing: 1.2,
    align: 'left',
    transforms,
  };
}

/** A `points` shape from a list: single points, or circles of `holeDiameter`. */
export function pointList(
  id: string,
  points: Array<[number, number]>,
  holeDiameter = 0,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'points',
    pointsMode: 'list',
    pointsList: points.map(([x, y], i) => ({ id: `${id}-p${i}`, x, y })),
    gridCountX: 3,
    gridCountY: 2,
    gridSpacingX: 20,
    gridSpacingY: 20,
    circleCount: 6,
    circleDiameter: 50,
    circleStartAngle: 0,
    holeDiameter,
    transforms,
  };
}

/** A `points` shape on a grid. */
export function pointGrid(
  id: string,
  countX: number,
  countY: number,
  spacing: number,
  holeDiameter = 0,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'points',
    pointsMode: 'grid',
    pointsList: [],
    gridCountX: countX,
    gridCountY: countY,
    gridSpacingX: spacing,
    gridSpacingY: spacing,
    circleCount: 6,
    circleDiameter: 50,
    circleStartAngle: 0,
    holeDiameter,
    transforms,
  };
}

/** A `points` shape round a circle. */
export function pointCircle(
  id: string,
  count: number,
  diameter: number,
  holeDiameter = 0,
  transforms: Transform[] = [],
): Shape {
  return {
    id,
    expanded: false,
    type: 'points',
    pointsMode: 'circle',
    pointsList: [],
    gridCountX: 3,
    gridCountY: 2,
    gridSpacingX: 20,
    gridSpacingY: 20,
    circleCount: count,
    circleDiameter: diameter,
    circleStartAngle: 0,
    holeDiameter,
    transforms,
  };
}

/** A shape `first` with `others` subtracted, in order. */
export function difference(
  id: string,
  first: string,
  ...others: string[]
): Shape {
  return {
    id,
    expanded: false,
    type: 'boolean',
    operands: [
      { id: `${id}-0`, shapeId: first },
      ...others.map((shapeId, i) => ({
        id: `${id}-${i + 1}`,
        shapeId,
        operation: 'difference' as const,
      })),
    ],
    fillRule: 'non-zero',
    transforms: [],
  };
}

export function hidden(shape: Shape): Shape {
  return { ...shape, hidden: true };
}

/** A star's outline round (cx, cy): sharp convex and concave corners. */
export function star(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  n = 5,
): Array<[number, number]> {
  return Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / n;
    return [
      +(cx + r * Math.cos(a)).toFixed(3),
      +(cy + r * Math.sin(a)).toFixed(3),
    ];
  });
}

/** An L, 50 × 40, its arms 15 wide: one concave corner. */
export const L_SHAPE: Array<[number, number]> = [
  [0, 0],
  [50, 0],
  [50, 15],
  [15, 15],
  [15, 40],
  [0, 40],
];

/** Two 20 mm squares joined by a 4 mm neck. */
export const DUMBBELL: Array<[number, number]> = [
  [0, 0],
  [20, 0],
  [20, 8],
  [40, 8],
  [40, 0],
  [60, 0],
  [60, 20],
  [40, 20],
  [40, 12],
  [20, 12],
  [20, 20],
  [0, 20],
];

/** A 60 × 40 frame with a 20 × 16 square hole (opposite winding). */
export const FRAME: PathCommand[] = [
  { command: 'M', x: 0, y: 0 },
  { command: 'L', x: 60, y: 0 },
  { command: 'L', x: 60, y: 40 },
  { command: 'L', x: 0, y: 40 },
  { command: 'Z' },
  { command: 'M', x: 20, y: 12 },
  { command: 'L', x: 20, y: 28 },
  { command: 'L', x: 40, y: 28 },
  { command: 'L', x: 40, y: 12 },
  { command: 'Z' },
];

/** A 50 mm disc with a round 20 mm hole (arcs) and a 6 mm square one. */
export const DISC_WITH_HOLES: PathCommand[] = [
  { command: 'M', x: 0, y: 25 },
  {
    command: 'A',
    rx: 25,
    ry: 25,
    rotation: 0,
    largeArc: false,
    sweep: true,
    x: 50,
    y: 25,
  },
  {
    command: 'A',
    rx: 25,
    ry: 25,
    rotation: 0,
    largeArc: false,
    sweep: true,
    x: 0,
    y: 25,
  },
  { command: 'Z' },
  { command: 'M', x: 15, y: 25 },
  {
    command: 'A',
    rx: 10,
    ry: 10,
    rotation: 0,
    largeArc: false,
    sweep: false,
    x: 35,
    y: 25,
  },
  {
    command: 'A',
    rx: 10,
    ry: 10,
    rotation: 0,
    largeArc: false,
    sweep: false,
    x: 15,
    y: 25,
  },
  { command: 'Z' },
  { command: 'M', x: 22, y: 5 },
  { command: 'L', x: 22, y: 11 },
  { command: 'L', x: 28, y: 11 },
  { command: 'L', x: 28, y: 5 },
  { command: 'Z' },
];

// -------------------------------------------------------------- transforms

export function translate(id: string, x: number, y: number): Transform {
  return {
    id,
    expanded: false,
    type: 'translate',
    translateX: x,
    translateY: y,
  };
}

export function repeat(
  id: string,
  countX: number,
  spaceX: number,
  countY = 1,
  spaceY = 0,
): Transform {
  return {
    id,
    expanded: false,
    type: 'repeat',
    repeatCountX: countX,
    repeatSpaceX: spaceX,
    repeatTypeX: 'every',
    repeatCountY: countY,
    repeatSpaceY: spaceY,
    repeatTypeY: 'every',
  };
}

type TabFields = Omit<
  Extract<Transform, { type: 'tabs' }>,
  'id' | 'expanded' | 'type'
>;

/** Tabs (4 evenly round each outline, outside, 6 wide, top 4 mm down). */
export function tabs(id: string, f: Partial<TabFields> = {}): Transform {
  return {
    id,
    expanded: false,
    type: 'tabs',
    tabsOn: 'contours',
    tabSide: 'outside',
    tabPlacement: 'evenly',
    tabPoints: [],
    tabCount: 4,
    tabWidth: 6,
    tabLength: 10,
    tabDepth: 4,
    tabOffset: 0,
    ...f,
  };
}

// ------------------------------------------------------------------- tools

export function tool(
  id: string,
  index: number,
  bitType: NonNullable<Tool['bitType']>,
  diameter: number,
  extra: Partial<Tool> = {},
): Tool {
  return {
    id,
    expanded: false,
    index,
    bitType,
    diameter,
    vAngle: 60,
    tipDiameter: 0,
    ramp: false,
    rampAngle: 3,
    ...extra,
  };
}

export const vBit = (
  id: string,
  index: number,
  diameter: number,
  vAngle: number,
  extra: Partial<Tool> = {},
) => tool(id, index, 'v-bit', diameter, { vAngle, ...extra });

// -------------------------------------------------------------- operations

function base(id: string, toolId: string, shapeId: string) {
  return { id, expanded: false, toolId, shapeId };
}

export function pocket(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'pocket'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'pocket',
    startDepth: 0,
    depthMode: 'per-step',
    depth: 3,
    steps: 1,
    leaveStock: 0,
    toolEngagement: 0.4,
    strategy: 'offset',
    alongAxis: 'y',
    allPassesInSameDirection: false,
    ...f,
  };
}

export function profile(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'profile'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
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
    ...f,
  };
}

export function vCarve(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'v-carve'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'v-carve',
    mode: 'both',
    startDepth: 0,
    unlimitedDepth: false,
    maxDepth: 3,
    stepover: 0.1,
    clearFlatBottom: true,
    centerLine: false,
    sharpCorners: true,
    sharpCornerAngle: 150,
    ...f,
  };
}

/** Clearing for v-carve (or inlay plug) `vcarveOperationId` on `shapeId`. */
export function imageEngrave(
  id: string,
  toolId: string,
  shapeId: string,
  image: string,
  f: Fields<'image-engrave'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'image-engrave',
    image,
    imageFit: 'contain',
    imageScale: 100,
    imageAlignX: 'center',
    imageAlignY: 'middle',
    imageOffsetX: 0,
    imageOffsetY: 0,
    invertImage: false,
    lightDepth: 0,
    darkDepth: 0.4,
    gamma: 1,
    lineSpacing: 0.5,
    rasterAngle: 0,
    sampleStep: 0.1,
    allPassesInSameDirection: false,
    ...f,
  };
}

export function imageEngraveClear(
  id: string,
  toolId: string,
  engraveOperationId: string,
  f: Fields<'image-engrave-clear'> = {},
): Operation {
  return {
    ...base(id, toolId, ''),
    type: 'image-engrave-clear',
    engraveOperationId,
    toolEngagement: 0.4,
    depthPerStep: 1,
    leaveStock: 0.2,
    ...f,
  };
}

export function vCarveClear(
  id: string,
  toolId: string,
  shapeId: string,
  vcarveOperationId: string,
  f: Fields<'v-carve-clear'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'v-carve-clear',
    vcarveOperationId,
    depthPerStep: 2,
    toolEngagement: 0.4,
    leaveStock: 0.1,
    ...f,
  };
}

export function inlayPlug(
  id: string,
  toolId: string,
  shapeId: string,
  vcarveOperationId: string,
  f: Fields<'inlay-plug'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'inlay-plug',
    vcarveOperationId,
    inlayGap: 0.5,
    inlayAbove: 1.5,
    inlayMargin: 5,
    ...f,
  };
}

export function drill(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'drill'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'drill',
    drillAt: 'centers',
    startDepth: 0,
    depth: 5,
    fullDiameter: false,
    peck: 0,
    chipBreak: false,
    dwell: 0,
    retractHeight: 1,
    output: 'moves',
    ...f,
  };
}

export function helix(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'helix'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'helix',
    startDepth: 0,
    depth: 5,
    pitch: 0.5,
    direction: 'climb',
    leaveStock: 0,
    clearMiddle: true,
    toolEngagement: 0.4,
    ...f,
  };
}

export function chamfer(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'chamfer'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'chamfer',
    chamferEdges: 'part',
    chamferWidth: 1,
    extraDepth: 0.2,
    passes: 1,
    direction: 'climb',
    ...f,
  };
}

export function rest(
  id: string,
  toolId: string,
  shapeId: string,
  pocketOperationId: string,
  f: Fields<'rest'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'rest',
    pocketOperationId,
    toolEngagement: 0.4,
    ...f,
  };
}

export function flat(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'flat'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'flat',
    startDepth: 0,
    depthMode: 'per-step',
    depth: 0.5,
    steps: 1,
    toolEngagement: 0.4,
    alongAxis: 'y',
    interpolateStepSize: false,
    allPassesInSameDirection: false,
    growByToolsize: true,
    applyConvexHullOnShape: true,
    pauseAfterEachStep: false,
    ...f,
  };
}

export function flatPlug(
  id: string,
  toolId: string,
  shapeId: string,
  pocketOperationId: string,
  f: Fields<'flat-plug'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'flat-plug',
    pocketOperationId,
    startDepth: 0,
    depthMode: 'per-step',
    depth: 2,
    steps: 2,
    inlayGap: 0.1,
    plugMirror: false,
    direction: 'climb',
    ...f,
  };
}

export function keyhole(
  id: string,
  toolId: string,
  shapeId: string,
  f: Fields<'keyhole'> = {},
): Operation {
  return {
    ...base(id, toolId, shapeId),
    type: 'keyhole',
    keyholeAt: 'centers',
    startDepth: 0,
    depth: 8,
    slotLength: 10,
    slotAngle: 90,
    ...f,
  };
}

export default [] satisfies Fixture[];
