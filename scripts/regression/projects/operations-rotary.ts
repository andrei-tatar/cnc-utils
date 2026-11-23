import { resolveStock } from '../../../src/cam/stock';
import { Fixture, project } from './fixture';
import { Operation, relief, reliefRough, tool } from './operations-parts';

// The stock on a rotary axis, cut as it turns: rounding it, and a 3D model
// carved all round.

const em6 = tool('t-em6', 1, 'end-mill', 6);
const ball3 = tool('t-ball', 2, 'ball-nose', 3);

function round(id: string, f: Partial<Operation> = {}): Operation {
  return {
    id,
    expanded: false,
    toolId: 't-em6',
    shapeId: '',
    type: 'rotary-round',
    roundDiameter: 38,
    roundStrategy: 'along',
    toolEngagement: 0.5,
    depthPerStep: 3,
    ...f,
  } as Operation;
}

/** A square pyramid 20 × 20, 10 high, as a binary STL data URL. */
function pyramidStl(): string {
  const triangles = [
    [0, 0, 0, 20, 0, 0],
    [20, 0, 0, 20, 20, 0],
    [20, 20, 0, 0, 20, 0],
    [0, 20, 0, 0, 0, 0],
  ].flatMap((edge) => [...edge, 10, 10, 10]);
  const buffer = Buffer.alloc(84 + (triangles.length / 9) * 50);
  buffer.writeUInt32LE(triangles.length / 9, 80);
  triangles.forEach((value, k) =>
    buffer.writeFloatLE(value, 84 + Math.floor(k / 9) * 50 + 12 + (k % 9) * 4),
  );
  return `data:application/octet-stream;base64,${buffer.toString('base64')}`;
}

export default [
  {
    name: 'rotary-round-square-along',
    covers:
      'round the stock: a 40 × 40 blank 120 long on a rotary axis along X to Ø38 from its end to a shoulder at X 90, lines along the axis (only at the corners until the faces are reached), 3 a level, ramping in; Ø6 end mill',
    model: project({
      tools: [{ ...em6, ramp: true, rampAngle: 10 }],
      operations: [round('o-round', { roundTo: 90 })],
      stock: resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'x',
        width: 120,
        height: 40,
        thickness: 40,
        x: 0,
        y: -20,
        zZero: 'axis',
      }),
    }),
  },
  {
    name: 'rotary-round-cylinder-around',
    covers:
      'round the stock: a Ø50 cylinder on a rotary axis along Y turned down to Ø44 all its length, rings round it a step along apart, one level; Ø6 end mill',
    model: project({
      tools: [em6],
      operations: [
        round('o-round', {
          roundDiameter: 44,
          roundStrategy: 'around',
          depthPerStep: 4,
        }),
      ],
      stock: resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'y',
        shape: 'cylinder',
        diameter: 50,
        height: 60,
        x: -25,
        y: 0,
        zZero: 'axis',
      }),
    }),
  },
  {
    name: 'relief-model-around',
    covers:
      '3D relief of a 3D model shape carved all round as the stock turns (wrapped, the model turning with the stock): the STL pyramid standing on a plane 5 above the axis of a Ø40 cylinder along X, 12 deep at most, roughed out first; lines along the axis',
    model: project({
      shapes: [
        {
          id: 's-model',
          expanded: false,
          type: 'model',
          modelFile: pyramidStl(),
          transforms: [
            {
              id: 't-align',
              expanded: false,
              type: 'align',
              alignX: 'left',
              alignXTo: 20,
              alignY: 'middle',
              alignYTo: 0,
              alignZ: 'top',
              alignZTo: -5,
            },
          ],
        },
      ],
      tools: [em6, ball3],
      operations: [
        reliefRough('o-rough', 't-em6', 'o-relief', { depthPerStep: 4 }),
        {
          ...relief('o-relief', 't-ball', '', '', {
            reliefSource: 'model',
            modelShapeId: 's-model',
            modelTurns: true,
            reliefMargin: 3,
            reliefDepth: 12,
            sampleStep: 0.25,
            toolEngagement: 0.2,
          }),
          wrap: true,
        },
      ],
      stock: resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'x',
        shape: 'cylinder',
        diameter: 40,
        width: 60,
        x: 0,
        y: -20,
        zZero: 'axis',
      }),
    }),
  },
  {
    name: 'relief-model-around-spiral',
    covers:
      '3D relief of a 3D model shape carved all round in one spiral (wrapped, the model turning, aroundPattern spiral): the STL pyramid in a Ø40 cylinder along X, 12 deep at most, 0.6 further along each turn, a ring at each end',
    model: project({
      shapes: [
        {
          id: 's-model',
          expanded: false,
          type: 'model',
          modelFile: pyramidStl(),
          transforms: [
            {
              id: 't-align',
              expanded: false,
              type: 'align',
              alignX: 'left',
              alignXTo: 20,
              alignY: 'middle',
              alignYTo: 0,
              alignZ: 'top',
              alignZTo: -5,
            },
          ],
        },
      ],
      tools: [ball3],
      operations: [
        {
          ...relief('o-relief', 't-ball', '', '', {
            reliefSource: 'model',
            modelShapeId: 's-model',
            modelTurns: true,
            aroundPattern: 'spiral',
            reliefMargin: 3,
            reliefDepth: 12,
            sampleStep: 0.25,
            toolEngagement: 0.2,
          }),
          wrap: true,
        },
      ],
      stock: resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'x',
        shape: 'cylinder',
        diameter: 40,
        width: 60,
        x: 0,
        y: -20,
        zZero: 'axis',
      }),
    }),
  },
] satisfies Fixture[];
