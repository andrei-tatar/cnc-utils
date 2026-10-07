import { Fixture, project } from './fixture';
import {
  circle,
  endMill6,
  lWithHole,
  pocket,
  profile,
  rect,
  roboto,
  shape,
  tf,
} from './parts';
import type { BooleanOperationType } from '../../../src/app/model-editor/shapes/shape-boolean';

/** Operands for booleans: a 50 × 30 rectangle and a d 30 circle overlapping its right edge. */
const operandShapes = () => [
  { ...shape('a-rect', rect(50, 30)), hidden: true },
  {
    ...shape('b-circle', circle(30), [
      tf('t-move', { type: 'translate', translateX: 50, translateY: 15 }),
    ]),
    hidden: true,
  },
];

const booleanOf = (
  id: string,
  operation: BooleanOperationType,
  fillRule: 'even-odd' | 'non-zero' | 'positive' | 'negative' = 'non-zero',
) =>
  shape(id, {
    type: 'boolean',
    operands: [
      { id: 'o0', shapeId: 'a-rect' },
      { id: 'o1', shapeId: 'b-circle', operation },
    ],
    fillRule,
  });

const booleanFixture = (operation: BooleanOperationType): Fixture => ({
  name: `shape-boolean-${operation}`,
  covers: `boolean shape, ${operation} of a rectangle and an overlapping circle (non-zero); outside profile and pocket`,
  model: project({
    shapes: [...operandShapes(), booleanOf('bool', operation)],
    tools: [endMill6],
    operations: [profile('op-profile', 'bool'), pocket('op-pocket', 'bool')],
  }),
});

/** Parts for nests. */
const nestParts = () => [
  { ...shape('part-rect', rect(60, 30, 3)), hidden: true },
  { ...shape('part-circle', circle(40)), hidden: true },
  {
    ...shape('part-bowtie', {
      type: 'bowtie',
      bowtieLength: 50,
      bowtieEndWidth: 25,
      bowtieWaist: 10,
    }),
    hidden: true,
  },
];

const nest = (sheet: number, width: number, height: number) =>
  shape('nest', {
    type: 'nest',
    nestItems: [
      { id: 'n0', shapeId: 'part-rect', count: 4, rotate: true },
      { id: 'n1', shapeId: 'part-circle', count: 3, rotate: false },
      { id: 'n2', shapeId: 'part-bowtie', count: 3, rotate: true },
    ],
    nestSheetWidth: width,
    nestSheetHeight: height,
    nestMargin: 5,
    nestGap: 8,
    nestSheet: sheet,
  });

export default [
  {
    name: 'shape-copy',
    covers:
      'copy shape: a copy of a scaled L-with-hole, rotated 45° and moved by its own transforms; profiles on original and copy, pocket on the copy',
    model: project({
      shapes: [
        shape('orig', lWithHole, [
          tf('t-scale', { type: 'scale', scaleX: 0.8, scaleY: 0.8 }),
        ]),
        shape('copy', { type: 'copy', copyOfId: 'orig' }, [
          tf('t-rotate', {
            type: 'rotate',
            rotateAngle: 45,
            around: 'xcenter-ycenter',
          }),
          tf('t-move', { type: 'translate', translateX: 70, translateY: 0 }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        profile('op-orig', 'orig'),
        profile('op-copy', 'copy'),
        pocket('op-copy-pocket', 'copy'),
      ],
    }),
  },
  booleanFixture('union'),
  booleanFixture('difference'),
  booleanFixture('intersection'),
  booleanFixture('xor'),
  {
    name: 'shape-boolean-chain-holes',
    covers:
      'boolean chain of four operands: an L with a hole ∪ circle − slot − text "8" (glyph with holes), even-odd fill; outside profile and pocket',
    model: project({
      shapes: [
        { ...shape('l', lWithHole), hidden: true },
        {
          ...shape('disc', circle(30), [
            tf('t-move', { type: 'translate', translateX: 30, translateY: 50 }),
          ]),
          hidden: true,
        },
        {
          ...shape('slot', { type: 'slot', slotLength: 40, slotWidth: 6 }, [
            tf('t-move', { type: 'translate', translateX: 35, translateY: 12 }),
          ]),
          hidden: true,
        },
        {
          ...shape(
            'eight',
            {
              type: 'text',
              text: '8',
              font: roboto,
              fontWeight: 800,
              fontStyle: 'normal',
              size: 16,
              letterSpacing: 0,
              lineSpacing: 1.2,
              align: 'left',
            },
            [
              tf('t-move', {
                type: 'translate',
                translateX: 8,
                translateY: 28,
              }),
            ],
          ),
          hidden: true,
        },
        shape('bool', {
          type: 'boolean',
          operands: [
            { id: 'o0', shapeId: 'l' },
            { id: 'o1', shapeId: 'disc', operation: 'union' },
            { id: 'o2', shapeId: 'slot', operation: 'difference' },
            { id: 'o3', shapeId: 'eight', operation: 'difference' },
          ],
          fillRule: 'even-odd',
        }),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'bool'), pocket('op-pocket', 'bool')],
    }),
  },
  {
    name: 'shape-boolean-fill-rules',
    covers:
      'boolean union of a self-overlapping operand (a repeat of overlapping circles) with a bar wound the other way (scale −1), once per fill rule: even-odd, positive, negative; outside profiles',
    model: project({
      shapes: [
        {
          ...shape('circles', circle(30), [
            tf('t-repeat', {
              type: 'repeat',
              repeatCountX: 3,
              repeatCountY: 1,
              repeatSpaceX: 20,
              repeatSpaceY: 0,
              repeatTypeX: 'every',
              repeatTypeY: 'every',
            }),
          ]),
          hidden: true,
        },
        {
          // Wound the other way round (mirrored), so each fill rule keeps a
          // different part.
          ...shape('bar', rect(60, 10), [
            tf('t-reverse', { type: 'scale', scaleX: -1, scaleY: 1 }),
            tf('t-move', { type: 'translate', translateX: 60, translateY: 0 }),
          ]),
          hidden: true,
        },
        ...(['even-odd', 'positive', 'negative'] as const).map((fillRule, i) =>
          shape(
            `bool-${fillRule}`,
            {
              type: 'boolean',
              operands: [
                { id: `${fillRule}-o0`, shapeId: 'circles' },
                { id: `${fillRule}-o1`, shapeId: 'bar', operation: 'union' },
              ],
              fillRule,
            },
            [
              tf('t-move', {
                type: 'translate',
                translateX: 0,
                translateY: 50 * i,
              }),
            ],
          ),
        ),
      ],
      tools: [endMill6],
      operations: [
        profile('op-even-odd', 'bool-even-odd'),
        profile('op-positive', 'bool-positive'),
        profile('op-negative', 'bool-negative'),
      ],
    }),
  },
  {
    name: 'shape-nest',
    covers:
      'nest shape: rectangles (may turn), circles (may not) and bowties (may turn) on a 250 × 200 sheet, margin 5, gap 8, all on sheet 1; outside profile',
    model: project({
      shapes: [...nestParts(), nest(1, 250, 200)],
      tools: [endMill6],
      operations: [profile('op-profile', 'nest')],
    }),
  },
  {
    name: 'shape-nest-overflow-sheet-1',
    covers:
      'nest shape with more parts than fit a 150 × 100 sheet: the first sheet (nestSheet 1); outside profile',
    model: project({
      shapes: [...nestParts(), nest(1, 150, 100)],
      tools: [endMill6],
      operations: [profile('op-profile', 'nest')],
    }),
  },
  {
    name: 'shape-nest-overflow-sheet-2',
    covers:
      'nest shape with more parts than fit a 150 × 100 sheet: the second sheet (nestSheet 2); outside profile',
    model: project({
      shapes: [...nestParts(), nest(2, 150, 100)],
      tools: [endMill6],
      operations: [profile('op-profile', 'nest')],
    }),
  },
  {
    name: 'shape-nest-layer',
    covers:
      'nest-layer shape: a dado (slot) and a hole pattern placed with each copy of two nested parts (one may turn); pocket the layers, profile the nest',
    model: project({
      shapes: [
        { ...shape('side', rect(80, 40)), hidden: true },
        { ...shape('shelf', rect(50, 30)), hidden: true },
        {
          ...shape('dado', rect(80, 8), [
            tf('t-move', { type: 'translate', translateX: 0, translateY: 16 }),
          ]),
          hidden: true,
        },
        {
          ...shape(
            'holes',
            {
              type: 'points',
              pointsMode: 'grid',
              pointsList: [],
              gridCountX: 2,
              gridCountY: 1,
              gridSpacingX: 30,
              gridSpacingY: 0,
              circleCount: 6,
              circleDiameter: 50,
              circleStartAngle: 0,
              holeDiameter: 8,
            },
            [
              tf('t-move', {
                type: 'translate',
                translateX: 10,
                translateY: 15,
              }),
            ],
          ),
          hidden: true,
        },
        shape('nest', {
          type: 'nest',
          nestItems: [
            { id: 'n0', shapeId: 'side', count: 2, rotate: false },
            { id: 'n1', shapeId: 'shelf', count: 3, rotate: true },
          ],
          nestSheetWidth: 200,
          nestSheetHeight: 150,
          nestMargin: 5,
          nestGap: 8,
          nestSheet: 1,
        }),
        shape('layers', {
          type: 'nest-layer',
          nestOfId: 'nest',
          nestLayers: [
            { id: 'l0', partShapeId: 'side', shapeId: 'dado' },
            { id: 'l1', partShapeId: 'shelf', shapeId: 'holes' },
          ],
        }),
      ],
      tools: [endMill6],
      operations: [
        pocket('op-layers', 'layers', { depth: 3, steps: 1 }),
        profile('op-nest', 'nest'),
      ],
    }),
  },
] satisfies Fixture[];
