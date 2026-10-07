import { Fixture, project } from './fixture';
import {
  DISC_WITH_HOLES,
  FRAME,
  L_SHAPE,
  pathData,
  polyline,
  profile,
  rect,
  repeat,
  star,
  tabs,
  text,
  tool,
  circle,
  translate,
} from './operations-parts';

// Profile operations: sides, directions, modes, finishing and onion-skin
// passes, lead-ins, ramps, open paths and tabs (keepTabs).

const em6 = tool('t-em6', 1, 'end-mill', 6);
const em3 = tool('t-em3', 2, 'end-mill', 3);

export default [
  {
    name: 'profile-outside-climb',
    covers: 'profile, side outside, climb, rectangle, 3 steps of 2 mm per-step',
    model: project({
      shapes: [rect('s-rect', 50, 30)],
      tools: [em6],
      operations: [profile('o-profile', 't-em6', 's-rect')],
    }),
  },
  {
    name: 'profile-outside-conventional',
    covers: 'profile, side outside, conventional, rounded rectangle (r 6)',
    model: project({
      shapes: [rect('s-rect', 50, 30, 6)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-rect', { direction: 'conventional' }),
      ],
    }),
  },
  {
    name: 'profile-inside-climb-circle',
    covers: 'profile, side inside, climb, 40 mm circle',
    model: project({
      shapes: [circle('s-circle', 40)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-circle', { side: 'inside' }),
      ],
    }),
  },
  {
    name: 'profile-inside-conventional-star',
    covers:
      'profile, side inside, conventional, star polyline (concave corners), 3 mm bit',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [
        profile('o-profile', 't-em3', 's-star', {
          side: 'inside',
          direction: 'conventional',
        }),
      ],
    }),
  },
  {
    name: 'profile-on-line-star',
    covers: 'profile, side on-line, climb and conventional, star polyline',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [
        profile('o-climb', 't-em3', 's-star', {
          side: 'on-line',
          depth: 1,
          steps: 1,
        }),
        profile('o-conv', 't-em3', 's-star', {
          side: 'on-line',
          direction: 'conventional',
          startDepth: 1,
          depth: 1,
          steps: 1,
        }),
      ],
    }),
  },
  {
    name: 'profile-mode-both-holes',
    covers:
      'profile outside, mode both, path-data disc with a round and a square hole (arcs)',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [em3],
      operations: [profile('o-profile', 't-em3', 's-disc', { mode: 'both' })],
    }),
  },
  {
    name: 'profile-mode-holes-only',
    covers:
      'profile outside, mode holes (only the holes cut), disc with two holes',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [em3],
      operations: [profile('o-profile', 't-em3', 's-disc', { mode: 'holes' })],
    }),
  },
  {
    name: 'profile-mode-contours-only',
    covers:
      'profile outside, mode contours (holes ignored), frame with a square hole',
    model: project({
      shapes: [pathData('s-frame', FRAME)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-frame', { mode: 'contours' }),
      ],
    }),
  },
  {
    name: 'profile-inside-mode-both-frame',
    covers:
      'profile inside, mode both, frame with a hole (inside of outline, outside of the hole)',
    model: project({
      shapes: [pathData('s-frame', FRAME)],
      tools: [em3],
      operations: [
        profile('o-profile', 't-em3', 's-frame', { side: 'inside' }),
      ],
    }),
  },
  {
    name: 'profile-leave-stock-finish-pass',
    covers: 'profile outside, leaveStock 0.4 with finishPass, L shape',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-l', {
          leaveStock: 0.4,
          finishPass: true,
        }),
      ],
    }),
  },
  {
    name: 'profile-leave-stock-no-finish',
    covers:
      'profile inside, leaveStock 0.4 without a finish pass, conventional, rounded rectangle',
    model: project({
      shapes: [rect('s-rect', 50, 30, 5)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-rect', {
          side: 'inside',
          direction: 'conventional',
          leaveStock: 0.4,
        }),
      ],
    }),
  },
  {
    name: 'profile-onion-skin',
    covers:
      'profile outside, onionSkin 0.5, depthMode total 6 mm ÷ 3 steps, frame with a hole',
    model: project({
      shapes: [pathData('s-frame', FRAME)],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-frame', {
          onionSkin: 0.5,
          depthMode: 'total',
          depth: 6,
          steps: 3,
        }),
      ],
    }),
  },
  {
    name: 'profile-onion-skin-finish-pass',
    covers:
      'profile outside, onionSkin 0.3 plus leaveStock 0.3 and finishPass, star',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [
        profile('o-profile', 't-em3', 's-star', {
          onionSkin: 0.3,
          leaveStock: 0.3,
          finishPass: true,
        }),
      ],
    }),
  },
  {
    name: 'profile-lead-in-outside',
    covers:
      'profile outside, leadIn 3 (arc lead-in/out on the waste side), rectangle and circle',
    model: project({
      shapes: [
        rect('s-rect', 40, 30),
        circle('s-circle', 20, [translate('x-move', 70, 15)]),
      ],
      tools: [em6],
      operations: [
        profile('o-rect', 't-em6', 's-rect', { leadIn: 3 }),
        profile('o-circle', 't-em6', 's-circle', { leadIn: 3 }),
      ],
    }),
  },
  {
    name: 'profile-lead-in-inside-conventional',
    covers:
      'profile inside, conventional, leadIn 2 with leaveStock and finishPass, L shape',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em3],
      operations: [
        profile('o-profile', 't-em3', 's-l', {
          side: 'inside',
          direction: 'conventional',
          leadIn: 2,
          leaveStock: 0.2,
          finishPass: true,
        }),
      ],
    }),
  },
  {
    name: 'profile-ramp-tool',
    covers: 'profile outside, tool ramp 4°, rounded rectangle, 3 steps',
    model: project({
      shapes: [rect('s-rect', 50, 30, 5)],
      tools: [tool('t-em6r', 1, 'end-mill', 6, { ramp: true, rampAngle: 4 })],
      operations: [profile('o-profile', 't-em6r', 's-rect')],
    }),
  },
  {
    name: 'profile-ramp-override-lead-in',
    covers:
      'profile outside, operation rampMode ramp (angle 10) on a plunging tool, with leadIn 2',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em3],
      operations: [
        profile('o-profile', 't-em3', 's-star', {
          rampMode: 'ramp',
          rampAngle: 10,
          leadIn: 2,
        }),
      ],
    }),
  },
  {
    name: 'profile-open-path-on-line',
    covers: 'profile on-line along an open zigzag polyline, ramp on, 2 steps',
    model: project({
      shapes: [
        polyline(
          's-zigzag',
          [
            [0, 0],
            [15, 20],
            [30, 0],
            [45, 20],
            [60, 0],
          ],
          false,
        ),
      ],
      tools: [tool('t-em3r', 1, 'end-mill', 3, { ramp: true, rampAngle: 5 })],
      operations: [
        profile('o-profile', 't-em3r', 's-zigzag', {
          side: 'on-line',
          depth: 1,
          steps: 2,
        }),
      ],
    }),
  },
  {
    name: 'profile-open-path-sides',
    covers:
      'profile outside and inside on an open polyline (side offset of an open path), line shape on-line',
    model: project({
      shapes: [
        polyline(
          's-open',
          [
            [0, 0],
            [40, 0],
            [40, 30],
            [10, 30],
          ],
          false,
        ),
        {
          id: 's-line',
          expanded: false,
          type: 'line',
          width: 40,
          transforms: [translate('x-move', 0, 50)],
        },
      ],
      tools: [em3],
      operations: [
        profile('o-outside', 't-em3', 's-open', { depth: 1, steps: 1 }),
        profile('o-inside', 't-em3', 's-open', {
          side: 'inside',
          startDepth: 1,
          depth: 1,
          steps: 1,
        }),
        profile('o-line', 't-em3', 's-line', {
          side: 'on-line',
          depth: 1,
          steps: 1,
        }),
      ],
    }),
  },
  {
    name: 'profile-text-outside',
    covers:
      'profile outside, text "Hi" weight 800 (letters with counters), 1.5 mm bit, 2 steps',
    model: project({
      shapes: [text('s-text', 'Hi', 30, 800)],
      tools: [tool('t-em15', 1, 'end-mill', 1.5)],
      operations: [
        profile('o-profile', 't-em15', 's-text', { depth: 1, steps: 2 }),
      ],
    }),
  },
  {
    name: 'profile-tabs-evenly',
    covers:
      'profile outside with tabs transform (4 evenly, outside, top 4 mm) on a rectangle, keepTabs',
    model: project({
      shapes: [rect('s-rect', 60, 40, 0, [tabs('x-tabs', { tabDepth: 4 })])],
      tools: [em6],
      operations: [profile('o-profile', 't-em6', 's-rect')],
    }),
  },
  {
    name: 'profile-tabs-points-both',
    covers:
      'profile outside, tabs at points on both outlines and holes, tabSide both, onion skin too',
    model: project({
      shapes: [
        pathData('s-frame', FRAME, [
          tabs('x-tabs', {
            tabsOn: 'both',
            tabSide: 'both',
            tabPlacement: 'points',
            tabPoints: [
              { id: 'tp-1', x: 30, y: -2 },
              { id: 'tp-2', x: 62, y: 20 },
              { id: 'tp-3', x: 30, y: 12 },
            ],
            tabWidth: 5,
            tabLength: 8,
            tabDepth: 4.5,
          }),
        ]),
      ],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-frame', { onionSkin: 0.3 }),
      ],
    }),
  },
  {
    name: 'profile-tabs-repeat-offset',
    covers:
      'tabs (3 per loop, tabOffset 5, inside side) carried by a repeat transform, outside profile of 3 discs',
    model: project({
      shapes: [
        circle('s-circle', 30, [
          translate('x-move', 20, 20),
          tabs('x-tabs', {
            tabCount: 3,
            tabOffset: 5,
            tabSide: 'inside',
            tabDepth: 3,
          }),
          repeat('x-repeat', 3, 45),
        ]),
      ],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-circle', { depth: 2.5, steps: 2 }),
      ],
    }),
  },
  {
    name: 'profile-tabs-disabled-transform',
    covers:
      'profile outside, tabs transform disabled (no tabs), start depth 1 and total depth 4 in 2 steps',
    model: project({
      shapes: [
        rect('s-rect', 40, 40, 4, [{ ...tabs('x-tabs'), disabled: true }]),
      ],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-rect', {
          startDepth: 1,
          depthMode: 'total',
          depth: 4,
          steps: 2,
        }),
      ],
    }),
  },
] satisfies Fixture[];
