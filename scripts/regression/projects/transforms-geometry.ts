import { Fixture, project } from './fixture';
import {
  circle,
  drill,
  drill5,
  endMill2,
  endMill6,
  lWithHole,
  pocket,
  polygon,
  profile,
  rect,
  roboto,
  shape,
  ShapeFields,
  tf,
} from './parts';

/** An outside profile per shape id. */
const profiles = (...ids: string[]) => ids.map((id) => profile(`op-${id}`, id));

/** A concave arrow: acute tips and reflex corners. */
const arrow = polygon([
  [0, 10],
  [40, 10],
  [40, 0],
  [70, 25],
  [40, 50],
  [40, 40],
  [0, 40],
]);

/** An open zig-zag. */
const zigzag = polygon(
  [
    [0, 0],
    [15, 20],
    [30, 0],
    [45, 20],
    [60, 5],
  ],
  false,
);

/** A dumbbell: two 30 mm squares joined by a 6 mm wide bar. */
const dumbbell = polygon([
  [0, 0],
  [30, 0],
  [30, 12],
  [50, 12],
  [50, 0],
  [80, 0],
  [80, 30],
  [50, 30],
  [50, 18],
  [30, 18],
  [30, 30],
  [0, 30],
]);

const move = (x: number, y: number) =>
  tf('move', { type: 'translate', translateX: x, translateY: y });

const offset = (
  value: number,
  joinType: 'square' | 'round' | 'miter',
  endType: 'polygon' | 'joined' | 'butt' | 'square' | 'round' = 'polygon',
  miterLimit = 2,
  arcTolerance = 0,
) =>
  tf('offset', {
    type: 'offset',
    offset: value,
    joinType,
    endType,
    miterLimit,
    arcTolerance,
  });

const text = (value: string): ShapeFields => ({
  type: 'text',
  text: value,
  font: roboto,
  fontWeight: 400,
  fontStyle: 'normal',
  size: 20,
  letterSpacing: 0,
  lineSpacing: 1.2,
  align: 'left',
});

export default [
  {
    name: 'transform-offset-positive',
    covers:
      'offset transform +4 (polygon ends) on an L with a hole and on a concave arrow, joins round / miter (limit 2) / miter (limit 10) / square; outside profiles and a pocket',
    model: project({
      shapes: [
        shape('l-round', lWithHole, [offset(4, 'round')]),
        shape('l-miter', lWithHole, [offset(4, 'miter'), move(90, 0)]),
        shape('arrow-miter10', arrow, [
          offset(4, 'miter', 'polygon', 10),
          move(0, 80),
        ]),
        shape('arrow-square', arrow, [offset(4, 'square'), move(100, 80)]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('l-round', 'l-miter', 'arrow-miter10', 'arrow-square'),
        pocket('op-l-round-pocket', 'l-round'),
      ],
    }),
  },
  {
    name: 'transform-offset-negative',
    covers:
      'offset transform −3 (polygon ends) on an L with a hole (hole grows, concave corner) and on a concave arrow, joins round / miter / square; outside profiles and a pocket',
    model: project({
      shapes: [
        shape('l-round', lWithHole, [offset(-3, 'round')]),
        shape('l-miter', lWithHole, [offset(-3, 'miter'), move(90, 0)]),
        shape('arrow-round', arrow, [offset(-3, 'round'), move(0, 80)]),
        shape('arrow-square', arrow, [offset(-3, 'square'), move(100, 80)]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('l-round', 'l-miter', 'arrow-round', 'arrow-square'),
        pocket('op-l-round-pocket', 'l-round'),
      ],
    }),
  },
  {
    name: 'transform-offset-split-and-vanish',
    covers:
      'offset transform −4 splitting a dumbbell into two parts at its 6 mm bar, and −6 making a 10 × 6 rectangle vanish; outside profiles and pocket',
    model: project({
      shapes: [
        shape('dumbbell', dumbbell, [offset(-4, 'round')]),
        shape('tiny', rect(10, 6), [offset(-6, 'round'), move(100, 0)]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('dumbbell', 'tiny'),
        pocket('op-dumbbell-pocket', 'dumbbell'),
      ],
    }),
  },
  {
    name: 'transform-offset-open-paths',
    covers:
      'offset transform on open paths: a line +3 round ends, a zig-zag +2 butt / square / joined ends, a zig-zag +2 with polygon ends (closed by the offset), a closed rectangle +3 joined (a ring); outside profiles and pocket',
    model: project({
      shapes: [
        shape('line-round', { type: 'line', width: 50 }, [
          offset(3, 'round', 'round'),
        ]),
        shape('zig-butt', zigzag, [offset(2, 'miter', 'butt'), move(70, 0)]),
        shape('zig-square', zigzag, [
          offset(2, 'square', 'square'),
          move(0, 40),
        ]),
        shape('zig-joined', zigzag, [
          offset(2, 'round', 'joined'),
          move(70, 40),
        ]),
        shape('zig-polygon', zigzag, [
          offset(2, 'round', 'polygon'),
          move(0, 80),
        ]),
        shape('rect-joined', rect(40, 25), [
          offset(3, 'miter', 'joined'),
          move(80, 80),
        ]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles(
          'line-round',
          'zig-butt',
          'zig-square',
          'zig-joined',
          'zig-polygon',
          'rect-joined',
        ),
        pocket('op-rect-joined-pocket', 'rect-joined'),
      ],
    }),
  },
  {
    name: 'transform-offset-arc-tolerance',
    covers:
      'offset transform +5 round joins on a circle and a slot with a coarse arc tolerance (0.5) and a fine one (0.01); outside profiles',
    model: project({
      shapes: [
        shape('coarse', circle(30), [offset(5, 'round', 'polygon', 2, 0.5)]),
        shape('fine', circle(30), [
          offset(5, 'round', 'polygon', 2, 0.01),
          move(60, 0),
        ]),
        shape('slot', { type: 'slot', slotLength: 40, slotWidth: 10 }, [
          offset(5, 'round', 'polygon', 2, 0.5),
          move(30, 50),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('coarse', 'fine', 'slot'),
    }),
  },
  {
    name: 'transform-corners-fillet',
    covers:
      'corners transform, fillet: radius 3 on all corners of a concave arrow (max angle 160), radius 4 on the concave corners only of an L with a hole, radius 20 on a 30 × 20 rectangle (bigger than its sides); outside profiles and pocket',
    model: project({
      shapes: [
        shape('arrow', arrow, [
          tf('corners', {
            type: 'corners',
            cornerMode: 'fillet',
            cornerSize: 3,
            cornerWhich: 'all',
            cornerMaxAngle: 160,
          }),
        ]),
        shape('l-concave', lWithHole, [
          tf('corners', {
            type: 'corners',
            cornerMode: 'fillet',
            cornerSize: 4,
            cornerWhich: 'concave',
            cornerMaxAngle: 160,
          }),
          move(90, 0),
        ]),
        shape('oversize', rect(30, 20), [
          tf('corners', {
            type: 'corners',
            cornerMode: 'fillet',
            cornerSize: 20,
            cornerWhich: 'all',
            cornerMaxAngle: 179,
          }),
          move(0, 70),
        ]),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('arrow', 'l-concave', 'oversize'),
        pocket('op-l-concave-pocket', 'l-concave'),
      ],
    }),
  },
  {
    name: 'transform-corners-chamfer',
    covers:
      'corners transform, chamfer: 3 mm on the convex corners only of an L with a hole, 4 mm on all corners of a bowtie sharper than 100°; outside profiles and pocket',
    model: project({
      shapes: [
        shape('l-convex', lWithHole, [
          tf('corners', {
            type: 'corners',
            cornerMode: 'chamfer',
            cornerSize: 3,
            cornerWhich: 'convex',
            cornerMaxAngle: 160,
          }),
        ]),
        shape(
          'bowtie',
          {
            type: 'bowtie',
            bowtieLength: 60,
            bowtieEndWidth: 30,
            bowtieWaist: 12,
          },
          [
            tf('corners', {
              type: 'corners',
              cornerMode: 'chamfer',
              cornerSize: 4,
              cornerWhich: 'all',
              cornerMaxAngle: 100,
            }),
            move(110, 25),
          ],
        ),
      ],
      tools: [endMill6],
      operations: [
        ...profiles('l-convex', 'bowtie'),
        pocket('op-bowtie-pocket', 'bowtie'),
      ],
    }),
  },
  {
    name: 'transform-dogbone',
    covers:
      'dogbone transform, dogbone style: inside a 40 × 30 rectangle for a pocket (6 mm tool, 0.05 clearance), outside an L with a hole for an outside profile (relieves its concave corner); pocket and profiles',
    model: project({
      shapes: [
        shape('pocket', rect(40, 30), [
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'inside',
            dogboneStyle: 'dogbone',
            dogboneMaxAngle: 120,
            dogboneClearance: 0.05,
          }),
        ]),
        shape('l-outside', lWithHole, [
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'outside',
            dogboneStyle: 'dogbone',
            dogboneMaxAngle: 120,
            dogboneClearance: 0.1,
          }),
          move(70, 0),
        ]),
      ],
      tools: [endMill6],
      operations: [
        pocket('op-pocket', 'pocket'),
        profile('op-pocket-inside', 'pocket', { side: 'inside' }),
        profile('op-l-outside', 'l-outside'),
      ],
    }),
  },
  {
    name: 'transform-dogbone-t-bones',
    covers:
      'dogbone transform, T-bone styles: into the longer side and into the shorter side of 50 × 20 mortises (inside), and T-bone long outside an L with a hole; pockets and profiles',
    model: project({
      shapes: [
        shape('long', rect(50, 20), [
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'inside',
            dogboneStyle: 't-bone-long',
            dogboneMaxAngle: 120,
            dogboneClearance: 0.05,
          }),
        ]),
        shape('short', rect(50, 20), [
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'inside',
            dogboneStyle: 't-bone-short',
            dogboneMaxAngle: 120,
            dogboneClearance: 0.05,
          }),
          move(0, 40),
        ]),
        shape('l-outside', lWithHole, [
          tf('dogbone', {
            type: 'dogbone',
            dogboneTool: 6,
            dogboneSide: 'outside',
            dogboneStyle: 't-bone-long',
            dogboneMaxAngle: 120,
            dogboneClearance: 0,
          }),
          move(80, 0),
        ]),
      ],
      tools: [endMill6],
      operations: [
        pocket('op-long', 'long'),
        pocket('op-short', 'short'),
        profile('op-l-outside', 'l-outside'),
      ],
    }),
  },
  {
    name: 'transform-simplify',
    covers:
      'simplify transform: tolerance 0.3 on text "Seo" (curved glyphs with holes), 1 mm on a d 50 circle (coarse polygon); outside profiles (6 mm) and a text pocket (2 mm)',
    model: project({
      shapes: [
        shape('text', text('Seo'), [
          tf('simplify', { type: 'simplify', simplifyTolerance: 0.3 }),
        ]),
        shape('circle', circle(50), [
          tf('simplify', { type: 'simplify', simplifyTolerance: 1 }),
          move(90, 10),
        ]),
      ],
      tools: [endMill6, endMill2],
      operations: [
        ...profiles('text', 'circle'),
        pocket('op-text-pocket', 'text', { depth: 2, steps: 1 }, endMill2.id),
      ],
    }),
  },
  {
    name: 'transform-convexhull',
    covers:
      'convexhull transform: whole shape (atShapeLevel) on text "Be8", per polygon (atShapeLevel off) on text "Be8", merged across shapes (mergeAllShapes) on an SVG of separate pieces, and on a concave arrow; outside profiles',
    model: project({
      shapes: [
        shape('shape-level', text('Be8'), [
          tf('hull', {
            type: 'convexhull',
            atShapeLevel: true,
            mergeAllShapes: false,
          }),
        ]),
        shape('per-polygon', text('Be8'), [
          tf('hull', {
            type: 'convexhull',
            atShapeLevel: false,
            mergeAllShapes: false,
          }),
          move(0, 40),
        ]),
        shape(
          'merged',
          {
            type: 'svg',
            svg: '<svg><rect x="0" y="0" width="10" height="10"/><circle cx="40" cy="20" r="8"/><rect x="10" y="30" width="20" height="5"/></svg>',
          },
          [
            tf('hull', {
              type: 'convexhull',
              atShapeLevel: false,
              mergeAllShapes: true,
            }),
            move(90, 0),
          ],
        ),
        shape('arrow', arrow, [
          tf('hull', {
            type: 'convexhull',
            atShapeLevel: true,
            mergeAllShapes: false,
          }),
          move(90, 60),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('shape-level', 'per-polygon', 'merged', 'arrow'),
    }),
  },
  {
    name: 'transform-bounds',
    covers:
      'bounds transform: one box round the whole shape and one per polygon (not holes), on text "Be8" and on a rotated L with a hole; outside profiles',
    model: project({
      shapes: [
        shape('text-shape', text('Be8'), [
          tf('bounds', { type: 'bounds', boundsOf: 'shape' }),
        ]),
        shape('text-polygon', text('Be8'), [
          tf('bounds', { type: 'bounds', boundsOf: 'polygon' }),
          move(0, 40),
        ]),
        shape('l-shape', lWithHole, [
          tf('rotate', {
            type: 'rotate',
            rotateAngle: 20,
            around: 'xcenter-ycenter',
          }),
          tf('bounds', { type: 'bounds', boundsOf: 'shape' }),
          move(80, 0),
        ]),
      ],
      tools: [endMill6],
      operations: profiles('text-shape', 'text-polygon', 'l-shape'),
    }),
  },
  {
    name: 'transform-centers',
    covers:
      'centers transform: centre points (radius 0) of each outline of a polar circle pattern, drilled; 3 mm circles at every polygon incl. holes, keeping the shape, on an L with a hole; drilling, profile and pocket',
    model: project({
      shapes: [
        shape('bolt-points', circle(10), [
          move(25, 0),
          tf('polar', {
            type: 'polar',
            polarCount: 5,
            polarAngle: 360,
            polarAround: 'point',
            polarX: 0,
            polarY: 0,
            polarRotate: false,
          }),
          tf('centers', {
            type: 'centers',
            centersRadius: 0,
            centersOf: 'outlines',
            centersKeepOriginal: false,
          }),
        ]),
        shape('l-marks', lWithHole, [
          tf('centers', {
            type: 'centers',
            centersRadius: 3,
            centersOf: 'all',
            centersKeepOriginal: true,
          }),
          move(60, -20),
        ]),
      ],
      tools: [endMill6, drill5],
      operations: [
        drill('op-drill', 'bolt-points', { drillAt: 'points' }),
        profile('op-l-marks', 'l-marks'),
        pocket('op-l-marks-pocket', 'l-marks'),
      ],
    }),
  },
] satisfies Fixture[];
