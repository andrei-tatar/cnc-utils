import { Fixture, project } from './fixture';
import {
  circle,
  difference,
  DUMBBELL,
  FRAME,
  hidden,
  L_SHAPE,
  pathData,
  pocket,
  polyline,
  rect,
  repeat,
  star,
  text,
  tool,
  translate,
} from './operations-parts';

// Pocket operations: every strategy, axis, depth reading, ramp setting and
// awkward shape (islands, holes, necks the bit can't get through).

const em6 = tool('t-em6', 1, 'end-mill', 6);
const em3 = tool('t-em3', 2, 'end-mill', 3);

export default [
  {
    name: 'pocket-offset-rectangle',
    covers:
      'pocket, offset strategy, 40×30 rectangle, 6 mm end mill, one 3 mm step',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [em6],
      operations: [pocket('o-pocket', 't-em6', 's-rect')],
    }),
  },
  {
    name: 'pocket-offset-rounded-per-step',
    covers:
      'pocket, offset, rounded rectangle (r 5), depthMode per-step 1.5 mm × 3 steps',
    model: project({
      shapes: [rect('s-rect', 50, 30, 5)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { depth: 1.5, steps: 3 }),
      ],
    }),
  },
  {
    name: 'pocket-offset-total-depth-start-depth',
    covers: 'pocket, offset, depthMode total (4 mm ÷ 3 steps), startDepth 1',
    model: project({
      shapes: [rect('s-rect', 40, 25)],
      tools: [em3],
      operations: [
        pocket('o-pocket', 't-em3', 's-rect', {
          startDepth: 1,
          depthMode: 'total',
          depth: 4,
          steps: 3,
        }),
      ],
    }),
  },
  {
    name: 'pocket-offset-star-sharp-corners',
    covers:
      'pocket, offset, closed star polyline (sharp concave corners), 3 mm end mill',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [pocket('o-pocket', 't-em3', 's-star', { depth: 2 })],
    }),
  },
  {
    name: 'pocket-raster-y-star',
    covers:
      'pocket, raster strategy along Y, alternating passes, star polyline',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [
        pocket('o-pocket', 't-em3', 's-star', {
          strategy: 'raster',
          alongAxis: 'y',
          allPassesInSameDirection: false,
        }),
      ],
    }),
  },
  {
    name: 'pocket-raster-x-same-direction',
    covers:
      'pocket, raster along X, allPassesInSameDirection true, L shape, 2 steps',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-l', {
          strategy: 'raster',
          alongAxis: 'x',
          allPassesInSameDirection: true,
          depth: 1.5,
          steps: 2,
        }),
      ],
    }),
  },
  {
    name: 'pocket-raster-x-alternating',
    covers: 'pocket, raster along X, alternating direction, L shape',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-l', {
          strategy: 'raster',
          alongAxis: 'x',
          allPassesInSameDirection: false,
        }),
      ],
    }),
  },
  {
    name: 'pocket-raster-leave-stock-island',
    covers:
      'pocket, raster along Y, leaveStock 0.4, frame with a square island (path-data hole)',
    model: project({
      shapes: [pathData('s-frame', FRAME)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-frame', {
          strategy: 'raster',
          alongAxis: 'y',
          leaveStock: 0.4,
        }),
      ],
    }),
  },
  {
    name: 'pocket-offset-leave-stock-circle',
    covers: 'pocket, offset, leaveStock 0.5, 40 mm circle',
    model: project({
      shapes: [circle('s-circle', 40)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-circle', { leaveStock: 0.5 }),
      ],
    }),
  },
  {
    name: 'pocket-engagement-low',
    covers:
      'pocket, offset, toolEngagement 0.15 (tight stepover), rounded rectangle',
    model: project({
      shapes: [rect('s-rect', 40, 30, 3)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { toolEngagement: 0.15 }),
      ],
    }),
  },
  {
    name: 'pocket-engagement-high-raster',
    covers:
      'pocket, toolEngagement 0.9 (wide stepover), raster along Y and offset compared on one shape',
    model: project({
      shapes: [rect('s-rect', 40, 30, 3)],
      tools: [em6],
      operations: [
        pocket('o-offset', 't-em6', 's-rect', { toolEngagement: 0.9 }),
        pocket('o-raster', 't-em6', 's-rect', {
          toolEngagement: 0.9,
          strategy: 'raster',
          startDepth: 3,
        }),
      ],
    }),
  },
  {
    name: 'pocket-offset-island-boolean',
    covers:
      'pocket, offset, rectangle minus a translated circle (boolean difference island)',
    model: project({
      shapes: [
        hidden(rect('s-outer', 60, 40)),
        hidden(circle('s-island', 16, [translate('x-move', 30, 20)])),
        difference('s-boolean', 's-outer', 's-island'),
      ],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-boolean', { depth: 2, steps: 2 }),
      ],
    }),
  },
  {
    name: 'pocket-text-islands',
    covers:
      'pocket, offset, text "B" weight 800 (letter with islands), 1 mm end mill',
    model: project({
      shapes: [text('s-text', 'B', 30, 800)],
      tools: [tool('t-em1', 1, 'end-mill', 1)],
      operations: [pocket('o-pocket', 't-em1', 's-text', { depth: 1 })],
    }),
  },
  {
    name: 'pocket-narrow-neck',
    covers:
      'pocket, offset and raster, dumbbell with a 4 mm neck a 6 mm bit cannot enter',
    model: project({
      shapes: [polyline('s-dumbbell', DUMBBELL, true)],
      tools: [em6],
      operations: [
        pocket('o-offset', 't-em6', 's-dumbbell'),
        pocket('o-raster', 't-em6', 's-dumbbell', {
          strategy: 'raster',
          startDepth: 3,
        }),
      ],
    }),
  },
  {
    name: 'pocket-too-small-for-bit',
    covers:
      'pocket, offset, 5 mm circle and 4 mm-wide slot narrower than the 6 mm bit (nothing to cut)',
    model: project({
      shapes: [
        circle('s-small', 5),
        {
          id: 's-slot',
          expanded: false,
          type: 'slot',
          slotLength: 30,
          slotWidth: 4,
          transforms: [],
        },
      ],
      tools: [em6],
      operations: [
        pocket('o-circle', 't-em6', 's-small'),
        pocket('o-slot', 't-em6', 's-slot'),
      ],
    }),
  },
  {
    name: 'pocket-ramp-tool',
    covers: 'pocket, offset, tool ramp on (3°), 2 steps, rounded rectangle',
    model: project({
      shapes: [rect('s-rect', 40, 30, 4)],
      tools: [tool('t-em6r', 1, 'end-mill', 6, { ramp: true, rampAngle: 3 })],
      operations: [
        pocket('o-pocket', 't-em6r', 's-rect', { depth: 2, steps: 2 }),
      ],
    }),
  },
  {
    name: 'pocket-ramp-override-raster',
    covers:
      'pocket, raster, tool ramp off but operation rampMode ramp with rampAngle 8',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-l', {
          strategy: 'raster',
          rampMode: 'ramp',
          rampAngle: 8,
          depth: 2,
          steps: 2,
        }),
      ],
    }),
  },
  {
    name: 'pocket-plunge-override',
    covers:
      'pocket, offset, tool ramp on but operation rampMode plunge; second op rampMode tool',
    model: project({
      shapes: [circle('s-circle', 30, [translate('x-move', 20, 20)])],
      tools: [tool('t-em6r', 1, 'end-mill', 6, { ramp: true, rampAngle: 5 })],
      operations: [
        pocket('o-plunge', 't-em6r', 's-circle', { rampMode: 'plunge' }),
        pocket('o-tool', 't-em6r', 's-circle', {
          rampMode: 'tool',
          startDepth: 3,
        }),
      ],
    }),
  },
  {
    name: 'pocket-ball-and-bull-nose',
    covers:
      'pocket with a ball-nose bit and with a bull-nose bit (corner radius 1), offset',
    model: project({
      shapes: [rect('s-rect', 40, 30, 2)],
      tools: [
        tool('t-ball', 1, 'ball-nose', 6),
        tool('t-bull', 2, 'bull-nose', 6, { cornerRadius: 1 }),
      ],
      operations: [
        pocket('o-ball', 't-ball', 's-rect', { depth: 2 }),
        pocket('o-bull', 't-bull', 's-rect', { depth: 2, startDepth: 2 }),
      ],
    }),
  },
  {
    name: 'pocket-repeat-grid',
    covers:
      'pocket, offset, a 15 mm square repeated 3×2 (several shapes: travel order)',
    model: project({
      shapes: [rect('s-rect', 15, 15, 0, [repeat('x-repeat', 3, 25, 2, 25)])],
      tools: [em6],
      operations: [pocket('o-pocket', 't-em6', 's-rect', { depth: 2 })],
    }),
  },
] satisfies Fixture[];
