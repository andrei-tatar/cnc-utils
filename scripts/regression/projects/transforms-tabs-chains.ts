import { Fixture, project } from './fixture';
import {
  circle,
  endMill6,
  expr,
  lWithHole,
  pocket,
  profile,
  rect,
  shape,
  tf,
} from './parts';
import type { TransformType } from '../../../src/app/model-editor/model';

type Tabs = Extract<TransformType, { type: 'tabs' }>;

/** A tabs transform: 6 wide, 10 long, top 4 mm down (cuts go 6 deep). */
const tabs = (fields: Partial<Omit<Tabs, 'id' | 'expanded' | 'type'>>) =>
  tf('tabs', {
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
    ...fields,
  });

const scale = (factor: number) =>
  tf('scale', { type: 'scale', scaleX: factor, scaleY: factor });

const move = (x: number, y: number) =>
  tf('move', { type: 'translate', translateX: x, translateY: y });

export default [
  {
    name: 'transform-tabs-evenly-outside',
    covers:
      'tabs transform: 4 tabs evenly round the outline, outside, on a rounded rectangle; outside profile through the stock',
    model: project({
      shapes: [shape('part', rect(80, 50, 5), [tabs({})])],
      tools: [endMill6],
      operations: [profile('op-profile', 'part')],
    }),
  },
  {
    name: 'transform-tabs-holes-inside',
    covers:
      'tabs transform: 2 tabs on the holes only, inside, offset 5 mm round the loop, on a ×1.5 L with a hole; outside profile (outline and hole)',
    model: project({
      shapes: [
        shape('part', lWithHole, [
          scale(1.5),
          tabs({
            tabsOn: 'holes',
            tabSide: 'inside',
            tabCount: 2,
            tabOffset: 5,
          }),
        ]),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'part')],
    }),
  },
  {
    name: 'transform-tabs-both-sides',
    covers:
      'tabs transform: 3 tabs on outlines and holes, reaching both sides of the line, on a ×1.5 L with a hole; outside profile and a pocket kept out of the tabs',
    model: project({
      shapes: [
        shape('part', lWithHole, [
          scale(1.5),
          tabs({ tabsOn: 'both', tabSide: 'both', tabCount: 3, tabOffset: 2 }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'part'),
        pocket('op-pocket', 'part', { depth: 6, steps: 3 }),
      ],
    }),
  },
  {
    name: 'transform-tabs-points',
    covers:
      'tabs transform at points (tabPlacement points, 3 tabPoints, nearest line of a d 60 circle and a rectangle), outside; outside profiles',
    model: project({
      shapes: [
        shape('disc', circle(60), [
          tabs({
            tabPlacement: 'points',
            tabPoints: [
              { id: 'p0', x: 40, y: 0 },
              { id: 'p1', x: -30, y: 5 },
              { id: 'p2', x: 0, y: 35 },
            ],
          }),
        ]),
        shape('plate', rect(60, 40), [
          move(50, -20),
          tabs({
            tabPlacement: 'points',
            tabSide: 'inside',
            tabPoints: [
              { id: 'p0', x: 110, y: 0 },
              { id: 'p1', x: 80, y: 25 },
            ],
          }),
        ]),
      ],
      tools: [endMill6],
      operations: [profile('op-disc', 'disc'), profile('op-plate', 'plate')],
    }),
  },
  {
    name: 'transform-tabs-carried',
    covers:
      'tabs carried through later transforms: tabs then repeat 3 × 1 and rotate 10° (affine: tabs move with the copies), tabs then offset +2 and corners (non-affine: tabs stay); outside profiles',
    model: project({
      shapes: [
        shape('repeated', rect(40, 30), [
          tabs({ tabCount: 2, tabOffset: 10 }),
          tf('repeat', {
            type: 'repeat',
            repeatCountX: 3,
            repeatCountY: 1,
            repeatSpaceX: 55,
            repeatSpaceY: 0,
            repeatTypeX: 'every',
            repeatTypeY: 'every',
          }),
          tf('rotate', {
            type: 'rotate',
            rotateAngle: 10,
            around: 'xmin-ymin',
          }),
        ]),
        shape('offset', rect(40, 30), [
          tabs({ tabCount: 3 }),
          tf('offset', {
            type: 'offset',
            offset: 2,
            joinType: 'miter',
            endType: 'polygon',
            miterLimit: 2,
            arcTolerance: 0,
          }),
          tf('corners', {
            type: 'corners',
            cornerMode: 'fillet',
            cornerSize: 3,
            cornerWhich: 'all',
            cornerMaxAngle: 160,
          }),
          move(0, 70),
        ]),
      ],
      tools: [endMill6],
      operations: [
        profile('op-repeated', 'repeated'),
        profile('op-offset', 'offset'),
      ],
    }),
  },
  {
    name: 'transform-chain',
    covers:
      'a chain of transforms on one shape: corners fillet → rotate 15° → mirror (keep original) → offset −1 → dogbone inside → repeat 2 × 2 → align left/bottom to 0; outside profile and pocket',
    model: project({
      shapes: [
        shape('chain', lWithHole, [
          tf('corners', {
            type: 'corners',
            cornerMode: 'fillet',
            cornerSize: 2,
            cornerWhich: 'convex',
            cornerMaxAngle: 160,
          }),
          tf('rotate', {
            type: 'rotate',
            rotateAngle: 15,
            around: 'xcenter-ycenter',
          }),
          tf('mirror', {
            type: 'mirror',
            mirrorAxis: 'vertical',
            mirrorAt: 'max',
            mirrorValue: 0,
            mirrorKeepOriginal: true,
          }),
          tf('offset', {
            type: 'offset',
            offset: -1,
            joinType: 'round',
            endType: 'polygon',
            miterLimit: 2,
            arcTolerance: 0,
          }),
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'inside',
            dogboneStyle: 'dogbone',
            dogboneMaxAngle: 120,
            dogboneClearance: 0.05,
          }),
          tf('repeat', {
            type: 'repeat',
            repeatCountX: 2,
            repeatCountY: 2,
            repeatSpaceX: 140,
            repeatSpaceY: 70,
            repeatTypeX: 'every',
            repeatTypeY: 'every',
          }),
          tf('align', {
            type: 'align',
            alignX: 'left',
            alignXTo: 0,
            alignY: 'bottom',
            alignYTo: 0,
          }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'chain'),
        pocket('op-pocket', 'chain'),
      ],
    }),
  },
  {
    name: 'transform-disabled',
    covers:
      'disabled transforms pass the shape through: a disabled rotate and a disabled offset around an enabled translate; outside profile and pocket',
    model: project({
      shapes: [
        shape('part', lWithHole, [
          {
            ...tf('rotate', {
              type: 'rotate',
              rotateAngle: 45,
              around: 'xcenter-ycenter',
            }),
            disabled: true,
          },
          move(20, 10),
          {
            ...tf('offset', {
              type: 'offset',
              offset: 5,
              joinType: 'round',
              endType: 'polygon',
              miterLimit: 2,
              arcTolerance: 0,
            }),
            disabled: true,
          },
        ]),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'part'), pocket('op-pocket', 'part')],
    }),
  },
  {
    name: 'transform-expressions',
    covers:
      'variables and expressions in number fields: w = 40, h = w / 2, r = 3mm (unit), a rectangle sized by them, a translate and an offset from expressions, the profile depth as an expression',
    model: project({
      variables: [
        { id: 'var-w', name: 'w', value: 40 },
        { id: 'var-h', name: 'h', value: 'w / 2' },
        { id: 'var-r', name: 'r', value: '3mm' },
      ],
      shapes: [
        shape('part', rect(expr('w'), expr('h + 5'), expr('r')), [
          tf('move', {
            type: 'translate',
            translateX: expr('w * 0.5'),
            translateY: expr('-h / 4'),
          }),
          tf('offset', {
            type: 'offset',
            offset: expr('r / 3'),
            joinType: 'round',
            endType: 'polygon',
            miterLimit: 2,
            arcTolerance: 0,
          }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'part', { depth: expr('6 / 3'), steps: 3 }),
        pocket('op-pocket', 'part'),
      ],
    }),
  },
] satisfies Fixture[];
