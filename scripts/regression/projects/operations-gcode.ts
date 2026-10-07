import { Fixture, project } from './fixture';
import { resolveGcodeOptions } from '../../../src/cam/gcode-options';
import { resolveStock } from '../../../src/cam/stock';
import {
  circle,
  drill,
  helix,
  pocket,
  pointGrid,
  polyline,
  profile,
  rect,
  repeat,
  star,
  text,
  tool,
  translate,
  vBit,
  vCarve,
} from './operations-parts';

// G-code options that change routing (travel order, geometry settings) or
// what's written (arcs, offsets, number format, tool changes), feeds and
// speeds overrides, and a disabled operation.

const em6 = tool('t-em6', 1, 'end-mill', 6);
const drill5 = tool('t-drill5', 2, 'drill', 5, { pointAngle: 118 });

/** A mixed job: pockets in a grid of squares, profiled discs, drilled points. */
function mixedJob() {
  return {
    shapes: [
      rect('s-squares', 12, 12, 0, [repeat('x-repeat', 3, 30, 2, 30)]),
      circle('s-discs', 16, [
        translate('x-move', 110, 10),
        repeat('x-repeat', 2, 25, 3, 25),
      ]),
      pointGrid('s-points', 4, 2, 15, 0, [translate('x-move', 0, 80)]),
    ],
    tools: [em6, drill5],
    operations: [
      pocket('o-pocket', 't-em6', 's-squares', { depth: 2 }),
      profile('o-profile', 't-em6', 's-discs', { depth: 2, steps: 2 }),
      drill('o-drill', 't-drill5', 's-points', { drillAt: 'points' as const }),
    ],
  };
}

export default [
  {
    name: 'gcode-optimize-travel-on',
    covers:
      'optimizeTravel on (default): pocket grid, profiled discs, drilled grid — the baseline for the next fixture',
    model: project({
      ...mixedJob(),
      gcode: resolveGcodeOptions({ optimizeTravel: true }),
    }),
  },
  {
    name: 'gcode-optimize-travel-off',
    covers:
      'optimizeTravel off: shapes cut as they come (pocket grid, profiled discs, drilled grid)',
    model: project({
      ...mixedJob(),
      gcode: resolveGcodeOptions({ optimizeTravel: false }),
    }),
  },
  {
    name: 'gcode-arcs-off',
    covers:
      'arcs off (no G2/G3): circle profile with leadIn, helix bore and a ramped rounded-rectangle pocket written as lines',
    model: project({
      shapes: [
        circle('s-circle', 30, [translate('x-move', 20, 20)]),
        circle('s-hole', 20, [translate('x-move', 70, 20)]),
        rect('s-rect', 40, 25, 6, [translate('x-move', 0, 50)]),
      ],
      tools: [
        em6,
        tool('t-em6r', 3, 'end-mill', 6, { ramp: true, rampAngle: 3 }),
      ],
      operations: [
        profile('o-profile', 't-em6', 's-circle', { leadIn: 3 }),
        helix('o-helix', 't-em6', 's-hole'),
        pocket('o-pocket', 't-em6r', 's-rect', { depth: 2, steps: 2 }),
      ],
      gcode: resolveGcodeOptions({ arcs: false }),
    }),
  },
  {
    name: 'gcode-arcs-on',
    covers:
      'arcs on (G2/G3 fitting incl. helices and ramps): same job as gcode-arcs-off',
    model: project({
      shapes: [
        circle('s-circle', 30, [translate('x-move', 20, 20)]),
        circle('s-hole', 20, [translate('x-move', 70, 20)]),
        rect('s-rect', 40, 25, 6, [translate('x-move', 0, 50)]),
      ],
      tools: [
        em6,
        tool('t-em6r', 3, 'end-mill', 6, { ramp: true, rampAngle: 3 }),
      ],
      operations: [
        profile('o-profile', 't-em6', 's-circle', { leadIn: 3 }),
        helix('o-helix', 't-em6', 's-hole'),
        pocket('o-pocket', 't-em6r', 's-rect', { depth: 2, steps: 2 }),
      ],
      gcode: resolveGcodeOptions({ arcs: true }),
    }),
  },
  {
    name: 'gcode-reference-point',
    covers:
      'referencePoint xmin-ymin moved to (10, 5): G-code offset from the cuts bounding box',
    model: project({
      shapes: [rect('s-rect', 50, 30, 0, [translate('x-move', 37, 21)])],
      tools: [em6],
      operations: [profile('o-profile', 't-em6', 's-rect')],
      gcode: resolveGcodeOptions({
        referencePoint: 'xmin-ymin',
        referenceX: 10,
        referenceY: 5,
      }),
    }),
  },
  {
    name: 'gcode-reference-point-center',
    covers:
      'referencePoint xcenter-ycenter at (0, 0) overriding an enabled stock xyZero',
    model: project({
      shapes: [rect('s-rect', 50, 30, 0, [translate('x-move', 20, 20)])],
      tools: [em6],
      operations: [pocket('o-pocket', 't-em6', 's-rect')],
      stock: resolveStock({
        enabled: true,
        width: 100,
        height: 80,
        thickness: 12,
        xyZero: 'xmax-ymax',
      }),
      gcode: resolveGcodeOptions({
        referencePoint: 'xcenter-ycenter',
        referenceX: 0,
        referenceY: 0,
      }),
    }),
  },
  {
    name: 'gcode-stock-offset',
    covers:
      'stock enabled at (-10, -10), 120×80×18, xyZero xmin-ymin, zZero bottom: offset applied to the written G-code only',
    model: project({
      shapes: [rect('s-rect', 50, 30, 4, [translate('x-move', 20, 20)])],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { depth: 2 }),
        profile('o-profile', 't-em6', 's-rect'),
      ],
      stock: resolveStock({
        enabled: true,
        width: 120,
        height: 80,
        thickness: 18,
        x: -10,
        y: -10,
        zZero: 'bottom',
        xyZero: 'xmin-ymin',
      }),
    }),
  },
  {
    name: 'gcode-stock-center-zero',
    covers:
      'stock enabled, xyZero xcenter-ycenter, zZero top, thin stock (6 mm) with a profile through it (spoilboard check)',
    model: project({
      shapes: [circle('s-circle', 40, [translate('x-move', 50, 40)])],
      tools: [em6],
      operations: [
        profile('o-profile', 't-em6', 's-circle', { depth: 2.5, steps: 3 }),
      ],
      stock: resolveStock({
        enabled: true,
        width: 100,
        height: 80,
        thickness: 6,
        zZero: 'top',
        xyZero: 'xcenter-ycenter',
      }),
    }),
  },
  {
    name: 'gcode-coarse-geometry',
    covers:
      'curveTolerance 0.2 and geometryDecimals 1 (coarse curves and offsets), decimals 3; text v-carve and circle pocket',
    model: project({
      shapes: [
        text('s-text', 'e', 30),
        circle('s-circle', 30, [translate('x-move', 50, 10)]),
      ],
      tools: [vBit('t-v60', 3, 6.35, 60), em6],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-text', { maxDepth: 2, stepover: 0.3 }),
        pocket('o-pocket', 't-em6', 's-circle', { depth: 2 }),
      ],
      gcode: resolveGcodeOptions({
        curveTolerance: 0.2,
        geometryDecimals: 1,
        decimals: 3,
      }),
    }),
  },
  {
    name: 'gcode-fine-geometry',
    covers:
      'curveTolerance 0.002 and geometryDecimals 4 (fine), decimals 4; circle profile and star pocket',
    model: project({
      shapes: [
        circle('s-circle', 30, [translate('x-move', 20, 20)]),
        polyline('s-star', star(80, 20, 18, 8), true),
      ],
      tools: [em6, tool('t-em2', 4, 'end-mill', 2)],
      operations: [
        profile('o-profile', 't-em6', 's-circle', {
          side: 'inside',
          depth: 1,
          steps: 2,
        }),
        pocket('o-pocket', 't-em2', 's-star', { depth: 1 }),
      ],
      gcode: resolveGcodeOptions({
        curveTolerance: 0.002,
        geometryDecimals: 4,
        decimals: 4,
      }),
    }),
  },
  {
    name: 'gcode-output-options',
    covers:
      'toolChange pause, header off, spindle off, returnHome, safetyHeight 10, feed rates 800 / 200, rapidRate 5000 (time estimate)',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [em6, tool('t-em3', 3, 'end-mill', 3)],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { depth: 2 }),
        profile('o-profile', 't-em3', 's-rect', { depth: 1, steps: 2 }),
      ],
      gcode: resolveGcodeOptions({
        toolChange: 'pause',
        header: false,
        spindle: false,
        returnHome: true,
        safetyHeight: 10,
        carveFeedRate: 800,
        plungeFeedRate: 200,
        rapidRate: 5000,
      }),
    }),
  },
  {
    name: 'gcode-single-tool-no-change',
    covers:
      'skipSingleToolChange with one tool, toolChange m6, spindleSpeed 18000, spindleDelay 0',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { depth: 2 }),
        profile('o-profile', 't-em6', 's-rect', { depth: 2, steps: 2 }),
      ],
      gcode: resolveGcodeOptions({
        toolChange: 'm6',
        skipSingleToolChange: true,
        spindleSpeed: 18000,
        spindleDelay: 0,
      }),
    }),
  },
  {
    name: 'gcode-feeds-overrides',
    covers:
      'feeds and speeds on the tool (feedRate, plungeFeedRate, spindleSpeed) and per operation overrides; toolChange none',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [
        tool('t-em6f', 1, 'end-mill', 6, {
          feedRate: 1500,
          plungeFeedRate: 400,
          spindleSpeed: 16000,
          fluteLength: 22,
        }),
      ],
      operations: [
        pocket('o-tool-feeds', 't-em6f', 's-rect', { depth: 2 }),
        pocket('o-op-feeds', 't-em6f', 's-rect', {
          startDepth: 2,
          depth: 2,
          feedRate: 900,
          plungeFeedRate: 150,
          spindleSpeed: 20000,
        }),
      ],
      gcode: resolveGcodeOptions({ toolChange: 'none' }),
    }),
  },
  {
    name: 'operation-disabled',
    covers:
      'a disabled operation between two enabled ones (left out of the G-code and preview)',
    model: project({
      shapes: [
        rect('s-rect', 40, 30),
        circle('s-circle', 20, [translate('x-move', 70, 15)]),
      ],
      tools: [em6, drill5],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { depth: 2 }),
        { ...profile('o-disabled', 't-em6', 's-rect'), disabled: true },
        drill('o-drill', 't-drill5', 's-circle'),
      ],
    }),
  },
  {
    name: 'operation-wrong-bit',
    covers:
      'operations given bits they do not accept (v-carve with an end mill, chamfer with an end mill, helix with a V-bit, keyhole with an end mill): nothing routed',
    model: project({
      shapes: [
        rect('s-rect', 40, 30),
        circle('s-circle', 20, [translate('x-move', 70, 15)]),
      ],
      tools: [em6, vBit('t-v90', 3, 12, 90)],
      operations: [
        vCarve('o-vcarve', 't-em6', 's-rect'),
        {
          id: 'o-chamfer',
          expanded: false,
          toolId: 't-em6',
          shapeId: 's-rect',
          type: 'chamfer',
          chamferEdges: 'part',
          chamferWidth: 1,
          extraDepth: 0.2,
          passes: 1,
          direction: 'climb',
        },
        helix('o-helix', 't-v90', 's-circle'),
        {
          id: 'o-keyhole',
          expanded: false,
          toolId: 't-em6',
          shapeId: 's-circle',
          type: 'keyhole',
          keyholeAt: 'centers',
          startDepth: 0,
          depth: 8,
          slotLength: 10,
          slotAngle: 90,
        },
      ],
    }),
  },
] satisfies Fixture[];
