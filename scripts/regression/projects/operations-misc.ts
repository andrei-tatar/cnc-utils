import { Fixture, project } from './fixture';
import {
  chamfer,
  circle,
  DISC_WITH_HOLES,
  drill,
  flat,
  FRAME,
  helix,
  keyhole,
  L_SHAPE,
  pathData,
  pocket,
  pointCircle,
  pointGrid,
  pointList,
  polyline,
  rect,
  repeat,
  rest,
  star,
  text,
  tool,
  translate,
  vBit,
} from './operations-parts';

// Drilling, helical boring, chamfers, rest machining, surfacing (flat) and
// keyhole slots.

const drill5 = tool('t-drill5', 1, 'drill', 5, { pointAngle: 118 });
const em6 = tool('t-em6', 2, 'end-mill', 6);
const em3 = tool('t-em3', 3, 'end-mill', 3);
const v90 = vBit('t-v90', 4, 12, 90);
const keyBit = tool('t-key', 5, 'keyhole', 9.5, {
  neckDiameter: 4.8,
  headHeight: 3.2,
});
const surfacer = tool('t-surf', 6, 'end-mill', 20);

/** Three 12 mm circles in a row. */
const HOLES = circle('s-holes', 12, [
  translate('x-move', 10, 10),
  repeat('x-repeat', 3, 25),
]);

export default [
  // ------------------------------------------------------------------ drill
  {
    name: 'drill-centers-circles',
    covers:
      'drill, drillAt centers on three circles, plain moves, depth 5, retractHeight 1',
    model: project({
      shapes: [HOLES],
      tools: [drill5],
      operations: [drill('o-drill', 't-drill5', 's-holes')],
    }),
  },
  {
    name: 'drill-points-grid',
    covers:
      'drill, drillAt points on a 4×3 points grid (single-point polygons), startDepth 1, retractHeight 3',
    model: project({
      shapes: [pointGrid('s-points', 4, 3, 15)],
      tools: [drill5],
      operations: [
        drill('o-drill', 't-drill5', 's-points', {
          drillAt: 'points',
          startDepth: 1,
          retractHeight: 3,
        }),
      ],
    }),
  },
  {
    name: 'drill-points-skips-centers',
    covers:
      'drill, drillAt points on circles plus a list of points (circles not drilled) and centers on the same',
    model: project({
      shapes: [
        pointList('s-list', [
          [0, 0],
          [30, 5],
          [12, 40],
        ]),
        pointList(
          's-holes',
          [
            [60, 0],
            [60, 30],
          ],
          10,
        ),
      ],
      tools: [drill5],
      operations: [
        drill('o-list-points', 't-drill5', 's-list', { drillAt: 'points' }),
        drill('o-holes-points', 't-drill5', 's-holes', { drillAt: 'points' }),
        drill('o-holes-centers', 't-drill5', 's-holes', { drillAt: 'centers' }),
      ],
    }),
  },
  {
    name: 'drill-peck-full-retract',
    covers:
      'drill, peck 2 (full retract between pecks), depth 9, points round a circle, moves',
    model: project({
      shapes: [pointCircle('s-points', 6, 40)],
      tools: [drill5],
      operations: [
        drill('o-drill', 't-drill5', 's-points', {
          drillAt: 'points',
          depth: 9,
          peck: 2,
        }),
      ],
    }),
  },
  {
    name: 'drill-peck-chip-break',
    covers: 'drill, peck 1.5 with chipBreak, dwell 0.5, moves',
    model: project({
      shapes: [HOLES],
      tools: [drill5],
      operations: [
        drill('o-drill', 't-drill5', 's-holes', {
          depth: 8,
          peck: 1.5,
          chipBreak: true,
          dwell: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'drill-cycles',
    covers:
      'drill, output cycles: G81 (plain), G82 (dwell 1), G83 (peck 2), G73 (peck 2 + chipBreak)',
    model: project({
      shapes: [HOLES],
      tools: [drill5],
      operations: [
        drill('o-g81', 't-drill5', 's-holes', { output: 'cycles' }),
        drill('o-g82', 't-drill5', 's-holes', { output: 'cycles', dwell: 1 }),
        drill('o-g83', 't-drill5', 's-holes', {
          output: 'cycles',
          depth: 8,
          peck: 2,
        }),
        drill('o-g73', 't-drill5', 's-holes', {
          output: 'cycles',
          depth: 8,
          peck: 2,
          chipBreak: true,
          retractHeight: 2,
        }),
      ],
    }),
  },
  {
    name: 'drill-full-diameter',
    covers:
      'drill, fullDiameter with a drill bit (point angle 118 and 90) vs with an end mill (ignored)',
    model: project({
      shapes: [HOLES],
      tools: [drill5, tool('t-drill8', 7, 'drill', 8, { pointAngle: 90 }), em6],
      operations: [
        drill('o-118', 't-drill5', 's-holes', { fullDiameter: true }),
        drill('o-90', 't-drill8', 's-holes', {
          fullDiameter: true,
          output: 'cycles',
        }),
        drill('o-endmill', 't-em6', 's-holes', { fullDiameter: true }),
      ],
    }),
  },

  // ------------------------------------------------------------------ helix
  {
    name: 'helix-climb-clear-middle',
    covers:
      'helix, climb, clearMiddle on (rings from the middle out), 24 mm holes with 6 mm bit, pitch 0.5',
    model: project({
      shapes: [
        circle('s-holes', 24, [
          translate('x-move', 15, 15),
          repeat('x-repeat', 2, 35),
        ]),
      ],
      tools: [em6],
      operations: [helix('o-helix', 't-em6', 's-holes')],
    }),
  },
  {
    name: 'helix-conventional-no-clear-middle',
    covers:
      'helix, conventional, clearMiddle off, leaveStock 0.3, startDepth 1, pitch 1',
    model: project({
      shapes: [
        circle('s-holes', 24, [
          translate('x-move', 15, 15),
          repeat('x-repeat', 2, 35),
        ]),
      ],
      tools: [em6],
      operations: [
        helix('o-helix', 't-em6', 's-holes', {
          direction: 'conventional',
          clearMiddle: false,
          leaveStock: 0.3,
          startDepth: 1,
          pitch: 1,
        }),
      ],
    }),
  },
  {
    name: 'helix-engagement-small-holes',
    covers:
      'helix, toolEngagement 0.7, 8 mm and 40 mm holes (points shape), round holes only: square hole and rectangle skipped',
    model: project({
      shapes: [
        pointList(
          's-small',
          [
            [0, 0],
            [20, 0],
          ],
          8,
        ),
        circle('s-big', 40, [translate('x-move', 70, 0)]),
        pathData('s-frame', FRAME, [translate('x-move', 0, 40)]),
      ],
      tools: [em3],
      operations: [
        helix('o-small', 't-em3', 's-small', { toolEngagement: 0.7, depth: 3 }),
        helix('o-big', 't-em3', 's-big', { toolEngagement: 0.7, depth: 3 }),
        helix('o-frame', 't-em3', 's-frame', { depth: 3 }),
      ],
    }),
  },
  {
    name: 'helix-hole-in-disc',
    covers:
      'helix on a disc with a round hole (outline bored, its hole is not), ball-nose bit',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [tool('t-ball', 8, 'ball-nose', 6)],
      operations: [
        helix('o-helix', 't-ball', 's-disc', { depth: 2, pitch: 0.8 }),
      ],
    }),
  },

  // ---------------------------------------------------------------- chamfer
  {
    name: 'chamfer-part-climb',
    covers:
      'chamfer, edges part (outline and holes), climb, width 1, extraDepth 0.2, 1 pass, disc with holes',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [v90],
      operations: [chamfer('o-chamfer', 't-v90', 's-disc')],
    }),
  },
  {
    name: 'chamfer-part-conventional-star',
    covers:
      'chamfer, edges part, conventional, width 1.5, extraDepth 0, star (sharp corners)',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [v90],
      operations: [
        chamfer('o-chamfer', 't-v90', 's-star', {
          direction: 'conventional',
          chamferWidth: 1.5,
          extraDepth: 0,
        }),
      ],
    }),
  },
  {
    name: 'chamfer-hole-passes',
    covers:
      'chamfer, edges hole (rim of a pocket), width 2, 2 passes, 30 mm circle and a rounded rectangle',
    model: project({
      shapes: [
        circle('s-circle', 30),
        rect('s-rect', 40, 20, 3, [translate('x-move', 30, -10)]),
      ],
      tools: [v90],
      operations: [
        chamfer('o-circle', 't-v90', 's-circle', {
          chamferEdges: 'hole',
          chamferWidth: 2,
          passes: 2,
        }),
        chamfer('o-rect', 't-v90', 's-rect', {
          chamferEdges: 'hole',
          chamferWidth: 2,
          passes: 2,
        }),
      ],
    }),
  },
  {
    name: 'chamfer-wide-multi-pass-tip',
    covers:
      'chamfer, width 4 in 3 passes, extraDepth 0.5, 60° V-bit with tipDiameter 0.3, L shape',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [vBit('t-v60tip', 4, 12, 60, { tipDiameter: 0.3 })],
      operations: [
        chamfer('o-chamfer', 't-v60tip', 's-l', {
          chamferWidth: 4,
          passes: 3,
          extraDepth: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'chamfer-ramp-text',
    covers:
      'chamfer with tool ramp (5°), edges part, text "Hi" weight 800, width 0.8',
    model: project({
      shapes: [text('s-text', 'Hi', 30, 800)],
      tools: [vBit('t-v90r', 4, 12, 90, { ramp: true, rampAngle: 5 })],
      operations: [
        chamfer('o-chamfer', 't-v90r', 's-text', { chamferWidth: 0.8 }),
      ],
    }),
  },

  // ------------------------------------------------------------------- rest
  {
    name: 'rest-star',
    covers:
      'rest machining a 6 mm offset pocket in a star with a 2 mm bit (corners the big bit left)',
    model: project({
      shapes: [polyline('s-star', star(30, 30, 28, 12), true)],
      tools: [em6, tool('t-em2', 9, 'end-mill', 2)],
      operations: [
        pocket('o-pocket', 't-em6', 's-star', { depth: 3 }),
        rest('o-rest', 't-em2', 's-star', 'o-pocket'),
      ],
    }),
  },
  {
    name: 'rest-steps-leave-stock',
    covers:
      'rest, borrowing pocket startDepth 0.5, depthMode total 4 ÷ 2, leaveStock 0.2; toolEngagement 0.25; text "B" islands',
    model: project({
      shapes: [text('s-text', 'B', 40, 800)],
      tools: [em3, tool('t-em1', 9, 'end-mill', 1)],
      operations: [
        pocket('o-pocket', 't-em3', 's-text', {
          startDepth: 0.5,
          depthMode: 'total',
          depth: 4,
          steps: 2,
          leaveStock: 0.2,
        }),
        rest('o-rest', 't-em1', 's-text', 'o-pocket', { toolEngagement: 0.25 }),
      ],
    }),
  },
  {
    name: 'rest-raster-pocket-ramp',
    covers:
      'rest after a raster pocket in an L with a 12 mm bit, rest with 3 mm bit and rampMode ramp (angle 5)',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [tool('t-em12', 10, 'end-mill', 12), em3],
      operations: [
        pocket('o-pocket', 't-em12', 's-l', {
          strategy: 'raster',
          depth: 2,
          steps: 2,
        }),
        rest('o-rest', 't-em3', 's-l', 'o-pocket', {
          rampMode: 'ramp',
          rampAngle: 5,
        }),
      ],
    }),
  },

  // ------------------------------------------------------------------- flat
  {
    name: 'flat-surfacing-default',
    covers:
      'flat (surfacing), 20 mm bit, engagement 0.4, along Y, alternating, growByToolsize and convex hull on, 0.5 mm',
    model: project({
      shapes: [rect('s-rect', 80, 60)],
      tools: [surfacer],
      operations: [flat('o-flat', 't-surf', 's-rect')],
    }),
  },
  {
    name: 'flat-along-x-same-direction',
    covers: 'flat, along X, allPassesInSameDirection, toolEngagement 0.7',
    model: project({
      shapes: [rect('s-rect', 80, 60)],
      tools: [surfacer],
      operations: [
        flat('o-flat', 't-surf', 's-rect', {
          alongAxis: 'x',
          allPassesInSameDirection: true,
          toolEngagement: 0.7,
        }),
      ],
    }),
  },
  {
    name: 'flat-steps-interpolate',
    covers:
      'flat, depthMode total 1.5 ÷ 3 steps, interpolateStepSize on, startDepth 0.2',
    model: project({
      shapes: [rect('s-rect', 70, 50, 10)],
      tools: [surfacer],
      operations: [
        flat('o-flat', 't-surf', 's-rect', {
          startDepth: 0.2,
          depthMode: 'total',
          depth: 1.5,
          steps: 3,
          interpolateStepSize: true,
        }),
      ],
    }),
  },
  {
    name: 'flat-concave-no-hull-no-grow',
    covers:
      'flat on a star with applyConvexHullOnShape off and growByToolsize off, 6 mm bit',
    model: project({
      shapes: [polyline('s-star', star(40, 40, 38, 16), true)],
      tools: [em6],
      operations: [
        flat('o-flat', 't-em6', 's-star', {
          applyConvexHullOnShape: false,
          growByToolsize: false,
        }),
      ],
    }),
  },
  {
    name: 'flat-concave-hull-pause',
    covers:
      'flat on an L with convex hull on, grow off, 2 steps per-step 0.4 with pauseAfterEachStep',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6],
      operations: [
        flat('o-flat', 't-em6', 's-l', {
          growByToolsize: false,
          depth: 0.4,
          steps: 2,
          pauseAfterEachStep: true,
        }),
      ],
    }),
  },

  // ---------------------------------------------------------------- keyhole
  {
    name: 'keyhole-centers-circles',
    covers:
      'keyhole bit (9.5 head, 4.8 neck), keyholeAt centers of circles, slotLength 10, slotAngle 90, depth 8',
    model: project({
      shapes: [HOLES],
      tools: [keyBit],
      operations: [keyhole('o-keyhole', 't-key', 's-holes')],
    }),
  },
  {
    name: 'keyhole-points-angle-0',
    covers:
      'keyhole, keyholeAt points on a point list, slotAngle 0, slotLength 12, startDepth 1, depth 7',
    model: project({
      shapes: [
        pointList('s-points', [
          [0, 0],
          [80, 0],
        ]),
      ],
      tools: [keyBit],
      operations: [
        keyhole('o-keyhole', 't-key', 's-points', {
          keyholeAt: 'points',
          slotAngle: 0,
          slotLength: 12,
          startDepth: 1,
          depth: 7,
        }),
      ],
    }),
  },
  {
    name: 'keyhole-points-mode-angle-225',
    covers:
      'keyhole, keyholeAt points on circles (skipped) and points, slotAngle 225, slotLength 8',
    model: project({
      shapes: [
        pointList(
          's-mixed',
          [
            [0, 0],
            [40, 0],
          ],
          0,
        ),
        pointList('s-circles', [[0, 40]], 10),
      ],
      tools: [keyBit],
      operations: [
        keyhole('o-points', 't-key', 's-mixed', {
          keyholeAt: 'points',
          slotAngle: 225,
          slotLength: 8,
        }),
        keyhole('o-circles', 't-key', 's-circles', {
          keyholeAt: 'points',
          slotAngle: 225,
          slotLength: 8,
        }),
      ],
    }),
  },
] satisfies Fixture[];
