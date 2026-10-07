import { Fixture, project } from './fixture';
import {
  circle,
  drill,
  drill5,
  endMill6,
  pocket,
  polygon,
  profile,
  rect,
  shape,
  tf,
} from './parts';

export default [
  {
    name: 'shape-rectangle',
    covers:
      'rectangle shape (sharp corners): outside profile and offset pocket',
    model: project({
      shapes: [shape('rect', rect(60, 40))],
      tools: [endMill6],
      operations: [profile('op-profile', 'rect'), pocket('op-pocket', 'rect')],
    }),
  },
  {
    name: 'shape-rectangle-radius',
    covers:
      'rectangle with corner radius 8: outside profile, inside profile, raster pocket',
    model: project({
      shapes: [shape('rect', rect(50, 30, 8))],
      tools: [endMill6],
      operations: [
        profile('op-outside', 'rect'),
        profile('op-inside', 'rect', {
          side: 'inside',
          direction: 'conventional',
        }),
        pocket('op-raster', 'rect', {
          strategy: 'raster',
          alongAxis: 'x',
          allPassesInSameDirection: true,
        }),
      ],
    }),
  },
  {
    name: 'shape-circle',
    covers: 'circle shape (d 40, centred on 0,0): outside profile and pocket',
    model: project({
      shapes: [shape('circle', circle(40))],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'circle'),
        pocket('op-pocket', 'circle'),
      ],
    }),
  },
  {
    name: 'shape-line',
    covers: 'line shape (open, 50 mm along X): on-line profile',
    model: project({
      shapes: [shape('line', { type: 'line', width: 50 })],
      tools: [endMill6],
      operations: [profile('op-profile', 'line', { side: 'on-line' })],
    }),
  },
  {
    name: 'shape-polyline-open',
    covers: 'open polyline (zig-zag, 5 points): on-line and outside profile',
    model: project({
      shapes: [
        shape(
          'zigzag',
          polygon(
            [
              [0, 0],
              [15, 20],
              [30, 0],
              [45, 20],
              [60, 5],
            ],
            false,
          ),
        ),
      ],
      tools: [endMill6],
      operations: [
        profile('op-on-line', 'zigzag', { side: 'on-line' }),
        profile('op-outside', 'zigzag'),
      ],
    }),
  },
  {
    name: 'shape-polyline-closed',
    covers:
      'closed polyline (concave arrow, acute and reflex corners): outside profile, inside profile, pocket',
    model: project({
      shapes: [
        shape(
          'arrow',
          polygon([
            [0, 10],
            [40, 10],
            [40, 0],
            [70, 25],
            [40, 50],
            [40, 40],
            [0, 40],
          ]),
        ),
      ],
      tools: [endMill6],
      operations: [
        profile('op-outside', 'arrow'),
        profile('op-inside', 'arrow', { side: 'inside' }),
        pocket('op-pocket', 'arrow'),
      ],
    }),
  },
  {
    name: 'shape-slot',
    covers: 'slot shape (40 × 10, round ends): outside profile and pocket',
    model: project({
      shapes: [shape('slot', { type: 'slot', slotLength: 40, slotWidth: 10 })],
      tools: [endMill6],
      operations: [profile('op-profile', 'slot'), pocket('op-pocket', 'slot')],
    }),
  },
  {
    name: 'shape-bowtie',
    covers:
      'bowtie shape (60 long, 30 ends, 12 waist): outside profile and pocket',
    model: project({
      shapes: [
        shape('bowtie', {
          type: 'bowtie',
          bowtieLength: 60,
          bowtieEndWidth: 30,
          bowtieWaist: 12,
        }),
      ],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'bowtie'),
        pocket('op-pocket', 'bowtie'),
      ],
    }),
  },
  {
    name: 'shape-box-panel',
    covers:
      'box-panel shape: finger joints, tabs bottom/top, slots left/right; outside profile',
    model: project({
      shapes: [
        shape('panel', {
          type: 'box-panel',
          boxWidth: 90,
          boxHeight: 60,
          boxThickness: 6,
          boxFingerWidth: 12,
          boxPlay: 0.1,
          boxBottom: 'tabs',
          boxRight: 'slots',
          boxTop: 'tabs',
          boxLeft: 'slots',
        }),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'panel')],
    }),
  },
  {
    name: 'shape-box-panel-mixed-edges',
    covers:
      'box-panel shape with a flat top, slots bottom, tabs left/right, no play; outside profile and pocket',
    model: project({
      shapes: [
        shape('panel', {
          type: 'box-panel',
          boxWidth: 70,
          boxHeight: 45,
          boxThickness: 9,
          boxFingerWidth: 10,
          boxPlay: 0,
          boxBottom: 'slots',
          boxRight: 'tabs',
          boxTop: 'flat',
          boxLeft: 'tabs',
        }),
      ],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'panel'),
        pocket('op-pocket', 'panel'),
      ],
    }),
  },
  {
    name: 'shape-hinge-cup',
    covers:
      'hinge-cup shape, both parts, Blum system, screw holes as points: cup pocket (end mill) and drilling (drill)',
    model: project({
      shapes: [
        shape('cup', {
          type: 'hinge-cup',
          hingeParts: 'cup',
          hingeCupDiameter: 35,
          hingeBoring: 5,
          hingeSystem: 'blum',
          hingeScrewSpacing: 45,
          hingeScrewOffset: 9.5,
          hingeScrewDiameter: 0,
        }),
        shape('hinge', {
          type: 'hinge-cup',
          hingeParts: 'both',
          hingeCupDiameter: 35,
          hingeBoring: 5,
          hingeSystem: 'blum',
          hingeScrewSpacing: 45,
          hingeScrewOffset: 9.5,
          hingeScrewDiameter: 0,
        }),
      ],
      tools: [endMill6, drill5],
      operations: [
        pocket('op-cup', 'cup', { depth: 12, steps: 3 }),
        drill('op-screws', 'hinge', { drillAt: 'points', depth: 10 }),
      ],
    }),
  },
  {
    name: 'shape-hinge-cup-custom',
    covers:
      'hinge-cup shape, custom screw spacing/offset, 8 mm dowel holes (circles), Hettich-like compact cup; screws only variant drilled',
    model: project({
      shapes: [
        shape('hinge', {
          type: 'hinge-cup',
          hingeParts: 'both',
          hingeCupDiameter: 26,
          hingeBoring: 3,
          hingeSystem: 'custom',
          hingeScrewSpacing: 52,
          hingeScrewOffset: 7,
          hingeScrewDiameter: 8,
        }),
        shape(
          'screws',
          {
            type: 'hinge-cup',
            hingeParts: 'screws',
            hingeCupDiameter: 35,
            hingeBoring: 4,
            hingeSystem: 'hettich',
            hingeScrewSpacing: 48,
            hingeScrewOffset: 6,
            hingeScrewDiameter: 0,
          },
          [tf('t-move', { type: 'translate', translateX: 0, translateY: -60 })],
        ),
      ],
      tools: [endMill6, drill5],
      operations: [
        pocket('op-pocket', 'hinge', { depth: 11, steps: 3 }),
        drill('op-drill', 'screws', { drillAt: 'points' }),
      ],
    }),
  },
  {
    name: 'shape-points-grid',
    covers: 'points shape, grid mode 3 × 2 at 20 mm, single points: drilling',
    model: project({
      shapes: [
        shape('grid', {
          type: 'points',
          pointsMode: 'grid',
          pointsList: [],
          gridCountX: 3,
          gridCountY: 2,
          gridSpacingX: 20,
          gridSpacingY: 20,
          circleCount: 6,
          circleDiameter: 50,
          circleStartAngle: 0,
          holeDiameter: 0,
        }),
      ],
      tools: [drill5],
      operations: [drill('op-drill', 'grid', { peck: 3, output: 'cycles' })],
    }),
  },
  {
    name: 'shape-points-circle-holes',
    covers:
      'points shape, bolt-circle mode (6 on d 60 from 15°), 10 mm holes: pocket and outside profile',
    model: project({
      shapes: [
        shape('bolts', {
          type: 'points',
          pointsMode: 'circle',
          pointsList: [],
          gridCountX: 3,
          gridCountY: 2,
          gridSpacingX: 20,
          gridSpacingY: 20,
          circleCount: 6,
          circleDiameter: 60,
          circleStartAngle: 15,
          holeDiameter: 10,
        }),
      ],
      tools: [endMill6],
      operations: [
        pocket('op-pocket', 'bolts'),
        profile('op-profile', 'bolts'),
      ],
    }),
  },
  {
    name: 'shape-points-list',
    covers:
      'points shape, list mode (4 typed points), 12 mm holes: pocket, plus drilling at the holes’ centres',
    model: project({
      shapes: [
        shape('list', {
          type: 'points',
          pointsMode: 'list',
          pointsList: [
            { id: 'p0', x: 0, y: 0 },
            { id: 'p1', x: 35, y: 5 },
            { id: 'p2', x: 20, y: 30 },
            { id: 'p3', x: -15, y: 25 },
          ],
          gridCountX: 3,
          gridCountY: 2,
          gridSpacingX: 20,
          gridSpacingY: 20,
          circleCount: 6,
          circleDiameter: 50,
          circleStartAngle: 0,
          holeDiameter: 12,
        }),
      ],
      tools: [endMill6, drill5],
      operations: [
        pocket('op-pocket', 'list'),
        drill('op-drill', 'list', { drillAt: 'centers' }),
      ],
    }),
  },
  {
    name: 'shape-clamp',
    covers:
      'clamp shape (keep-out rectangle, clamp: true) next to a part whose outside profile comes within reach',
    model: project({
      shapes: [
        shape('part', rect(60, 40, 4)),
        {
          ...shape('clamp', rect(20, 15), [
            tf('t-move', { type: 'translate', translateX: 64, translateY: 10 }),
          ]),
          clamp: true,
        },
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'part', { onionSkin: 0.5 })],
    }),
  },
] satisfies Fixture[];
