import { Fixture, project } from './fixture';
import { resolveStock } from '../../../src/cam/stock';
import { flip, pocket, polyline, profile, tool } from './operations-parts';

// Two-sided jobs: operations below a flip step are cut on the board's back,
// drawn where they are on it seen from the top and cut mirrored across the
// line it turns over along.

const board = resolveStock({
  enabled: true,
  width: 200,
  height: 100,
  thickness: 20,
  x: 0,
  y: 0,
  zZero: 'top',
  xyZero: 'xmin-ymin',
} as any);

const part = polyline(
  's-part',
  [
    [20, 20],
    [180, 20],
    [180, 80],
    [20, 80],
  ],
  true,
);
// Lopsided, so a mirror that went wrong shows.
const front = polyline(
  's-front',
  [
    [40, 30],
    [90, 30],
    [40, 70],
  ],
  true,
);
const back = polyline(
  's-back',
  [
    [120, 30],
    [160, 30],
    [160, 45],
    [135, 45],
    [135, 70],
    [120, 70],
  ],
  true,
);
const em6 = tool('t-em6', 1, 'end-mill', 6);

export default [
  {
    name: 'flip-along-y-dowels',
    covers:
      'two-sided board turned over along Y: a pocket and half the outline cut from the front, dowel holes on the flip line 10 in from the ends (5 into the spoilboard, not flagged), then a lopsided pocket and the rest of the outline from the back, mirrored in X; M0 at the turn',
    model: project({
      shapes: [part, front, back],
      tools: [em6],
      operations: [
        pocket('o-front', 't-em6', 's-front'),
        profile('o-half', 't-em6', 's-part', { depth: 2, steps: 5 }),
        flip('o-flip', 't-em6', {
          flipAlong: 'y',
          dowelInset: 10,
          dowelDepth: 5,
        }),
        pocket('o-back', 't-em6', 's-back'),
        profile('o-through', 't-em6', 's-part', {
          depthMode: 'total',
          depth: 10.5,
          steps: 5,
        }),
      ],
      stock: board,
    }),
  },
  {
    name: 'flip-along-x-and-back',
    covers:
      'board turned over along X without dowels for a lopsided pocket on the back (mirrored in Y), then back again for a second pocket on the front: two stops',
    model: project({
      shapes: [front, back],
      tools: [em6],
      operations: [
        flip('o-flip', 't-em6', { dowels: false }),
        pocket('o-back', 't-em6', 's-back'),
        flip('o-flip-again', 't-em6', { dowels: false }),
        pocket('o-front', 't-em6', 's-front'),
      ],
      stock: board,
    }),
  },
] satisfies Fixture[];
