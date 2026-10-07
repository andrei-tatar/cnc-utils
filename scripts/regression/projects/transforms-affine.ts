import { Fixture, project } from './fixture';
import {
  circle,
  endMill6,
  lWithHole,
  pocket,
  profile,
  rect,
  shape,
  tf,
} from './parts';

/** An outside profile per shape id. */
const profiles = (...ids: string[]) => ids.map((id) => profile(`op-${id}`, id));

export default [
  {
    name: 'transform-translate',
    covers:
      'translate transform (+25, −10) on an L with a hole; outside profile and pocket',
    model: project({
      shapes: [
        shape('l', lWithHole, [
          tf('t', { type: 'translate', translateX: 25, translateY: -10 }),
        ]),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'l'), pocket('op-pocket', 'l')],
    }),
  },
  {
    name: 'transform-align',
    covers:
      'align transform: left/bottom to (10, 5); middle/top to (0, −10); right to 150 with Y not aligned; none on X with Y middle to 80',
    model: project({
      shapes: [
        shape('a', lWithHole, [
          tf('t', {
            type: 'align',
            alignX: 'left',
            alignXTo: 10,
            alignY: 'bottom',
            alignYTo: 5,
          }),
        ]),
        shape('b', circle(30), [
          tf('t', {
            type: 'align',
            alignX: 'middle',
            alignXTo: 0,
            alignY: 'top',
            alignYTo: -10,
          }),
        ]),
        shape('c', rect(30, 20, 4), [
          tf('t', {
            type: 'align',
            alignX: 'right',
            alignXTo: 150,
            alignY: 'none',
            alignYTo: 0,
          }),
        ]),
        shape('d', { type: 'slot', slotLength: 40, slotWidth: 10 }, [
          tf('t', {
            type: 'align',
            alignX: 'none',
            alignXTo: 0,
            alignY: 'middle',
            alignYTo: 80,
          }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('a', 'b', 'c', 'd'),
    }),
  },
  {
    name: 'transform-rotate',
    covers:
      'rotate transform: 30° about the centre, −90° about xmax-ymin, 135° about a point (10, 10), 45° about xmin-ycenter; outside profiles',
    model: project({
      shapes: [
        shape('a', lWithHole, [
          tf('t', {
            type: 'rotate',
            rotateAngle: 30,
            around: 'xcenter-ycenter',
          }),
        ]),
        shape('b', lWithHole, [
          tf('t', { type: 'rotate', rotateAngle: -90, around: 'xmax-ymin' }),
          tf('t2', { type: 'translate', translateX: 100, translateY: 0 }),
        ]),
        shape('c', rect(40, 10), [
          tf('t', {
            type: 'rotate',
            rotateAngle: 135,
            around: 'point',
            aroundX: 10,
            aroundY: 10,
          }),
        ]),
        shape('d', { type: 'slot', slotLength: 40, slotWidth: 10 }, [
          tf('t', { type: 'rotate', rotateAngle: 45, around: 'xmin-ycenter' }),
          tf('t2', { type: 'translate', translateX: 0, translateY: 80 }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('a', 'b', 'c', 'd'),
    }),
  },
  {
    name: 'transform-scale',
    covers:
      'scale transform: uniform ×1.5 on an L with a hole, non-uniform 2 × 0.5 on a circle (ellipse) and 0.5 × 1.5 on the L, negative −1 × 1 (mirrored, reversed winding); outside profiles and pocket',
    model: project({
      shapes: [
        shape('uniform', lWithHole, [
          tf('t', { type: 'scale', scaleX: 1.5, scaleY: 1.5 }),
        ]),
        shape('ellipse', circle(30), [
          tf('t', { type: 'scale', scaleX: 2, scaleY: 0.5 }),
          tf('t2', { type: 'translate', translateX: 140, translateY: 20 }),
        ]),
        shape('squashed', lWithHole, [
          tf('t', { type: 'scale', scaleX: 0.5, scaleY: 1.5 }),
          tf('t2', { type: 'translate', translateX: 0, translateY: 90 }),
        ]),
        shape('negative', lWithHole, [
          tf('t', { type: 'scale', scaleX: -1, scaleY: 1 }),
          tf('t2', { type: 'translate', translateX: 160, translateY: 90 }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('uniform', 'ellipse', 'squashed', 'negative'),
        pocket('op-negative-pocket', 'negative'),
      ],
    }),
  },
  {
    name: 'transform-fit',
    covers:
      'fit transform: width 80 only (bottom left), 40 × 40 without keeping aspect (centre), 50 × 20 keeping aspect (top right), height 30 only (bottom middle); outside profiles',
    model: project({
      shapes: [
        shape('width', lWithHole, [
          tf('t', {
            type: 'fit',
            fitWidth: 80,
            fitHeight: null,
            fitKeepAspect: true,
            fitAround: 'xmin-ymin',
          }),
        ]),
        shape('stretch', lWithHole, [
          tf('t', {
            type: 'fit',
            fitWidth: 40,
            fitHeight: 40,
            fitKeepAspect: false,
            fitAround: 'xcenter-ycenter',
          }),
          tf('t2', { type: 'translate', translateX: 100, translateY: 0 }),
        ]),
        shape('aspect', lWithHole, [
          tf('t', {
            type: 'fit',
            fitWidth: 50,
            fitHeight: 20,
            fitKeepAspect: true,
            fitAround: 'xmax-ymax',
          }),
          tf('t2', { type: 'translate', translateX: 0, translateY: 100 }),
        ]),
        shape('height', circle(20), [
          tf('t', {
            type: 'fit',
            fitWidth: 0,
            fitHeight: 30,
            fitKeepAspect: true,
            fitAround: 'xcenter-ymin',
          }),
          tf('t2', { type: 'translate', translateX: 120, translateY: 100 }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('width', 'stretch', 'aspect', 'height'),
    }),
  },
  {
    name: 'transform-flip',
    covers:
      'flip transform: horizontal, vertical, and both, on an L with a hole; outside profiles',
    model: project({
      shapes: [
        shape('h', lWithHole, [
          tf('t', { type: 'flip', flipHorizontal: true, flipVertical: false }),
        ]),
        shape('v', lWithHole, [
          tf('t', { type: 'flip', flipHorizontal: false, flipVertical: true }),
          tf('t2', { type: 'translate', translateX: 80, translateY: 0 }),
        ]),
        shape('hv', lWithHole, [
          tf('t', { type: 'flip', flipHorizontal: true, flipVertical: true }),
          tf('t2', { type: 'translate', translateX: 160, translateY: 0 }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('h', 'v', 'hv'),
    }),
  },
  {
    name: 'transform-mirror',
    covers:
      'mirror transform: vertical at max keeping the original, horizontal at min without it, vertical at x = −10 keeping it, horizontal at the centre keeping it (overlapping copy); outside profiles',
    model: project({
      shapes: [
        shape('a', lWithHole, [
          tf('t', {
            type: 'mirror',
            mirrorAxis: 'vertical',
            mirrorAt: 'max',
            mirrorValue: 0,
            mirrorKeepOriginal: true,
          }),
        ]),
        shape('b', lWithHole, [
          tf('t', {
            type: 'mirror',
            mirrorAxis: 'horizontal',
            mirrorAt: 'min',
            mirrorValue: 0,
            mirrorKeepOriginal: false,
          }),
          tf('t2', { type: 'translate', translateX: 140, translateY: 0 }),
        ]),
        shape(
          'c',
          {
            type: 'bowtie',
            bowtieLength: 40,
            bowtieEndWidth: 20,
            bowtieWaist: 8,
          },
          [
            tf('t0', { type: 'translate', translateX: 10, translateY: 90 }),
            tf('t', {
              type: 'mirror',
              mirrorAxis: 'vertical',
              mirrorAt: 'value',
              mirrorValue: -10,
              mirrorKeepOriginal: true,
            }),
          ],
        ),
        shape('d', lWithHole, [
          tf('t', {
            type: 'mirror',
            mirrorAxis: 'horizontal',
            mirrorAt: 'center',
            mirrorValue: 0,
            mirrorKeepOriginal: true,
          }),
          tf('t2', { type: 'translate', translateX: 90, translateY: 80 }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('a', 'b', 'c', 'd'),
    }),
  },
  {
    name: 'transform-repeat',
    covers:
      'repeat transform: 3 × 2 every 70 / 60 on an L with a hole; 4 rectangles within 100 (overlapping copies) by 2 within 30; outside profiles and a pocket on the overlaps',
    model: project({
      shapes: [
        shape('every', lWithHole, [
          tf('t', {
            type: 'repeat',
            repeatCountX: 3,
            repeatCountY: 2,
            repeatSpaceX: 70,
            repeatSpaceY: 60,
            repeatTypeX: 'every',
            repeatTypeY: 'every',
          }),
        ]),
        shape('within', rect(40, 20), [
          tf('t', {
            type: 'repeat',
            repeatCountX: 4,
            repeatCountY: 2,
            repeatSpaceX: 100,
            repeatSpaceY: 30,
            repeatTypeX: 'within',
            repeatTypeY: 'within',
          }),
          tf('t2', { type: 'translate', translateX: 0, translateY: 140 }),
        ]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('every', 'within'),
        pocket('op-within-pocket', 'within'),
      ],
    }),
  },
  {
    name: 'transform-polar',
    covers:
      'polar transform: 6 slots round the point (0, 0) over 360° turned with their position; 5 L shapes over 180° round the shape’s centre, not turned; outside profiles',
    model: project({
      shapes: [
        shape('spokes', { type: 'slot', slotLength: 30, slotWidth: 8 }, [
          tf('t0', { type: 'translate', translateX: 30, translateY: 0 }),
          tf('t', {
            type: 'polar',
            polarCount: 6,
            polarAngle: 360,
            polarAround: 'point',
            polarX: 0,
            polarY: 0,
            polarRotate: true,
          }),
        ]),
        shape('fan', lWithHole, [
          tf('t', {
            type: 'polar',
            polarCount: 5,
            polarAngle: 180,
            polarAround: 'shape-center',
            polarX: 0,
            polarY: 0,
            polarRotate: false,
          }),
          tf('t2', { type: 'translate', translateX: 120, translateY: 0 }),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('spokes', 'fan'),
    }),
  },
] satisfies Fixture[];
