import { signedArea } from '../../cam/arcs';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { DEFAULT_GCODE_OPTIONS } from '../../cam/gcode-options';
import { flipAxis, operationPointOnBlank } from '../../cam/rotary';
import { resolveStock } from '../../cam/stock';
import { CamShape } from '../../cam/types';
import {
  jobFlip,
  onBack,
  operationFrame,
  rotationMismatch,
} from '../model-editor/operations/rotation';
import { dowelHoles, flipFrame, flipShapes } from './flip';
import { programSteps } from './gcode';

// A 200 × 100 board, 20 thick, its corner at (−100, −50).
const stock = resolveStock({
  enabled: true,
  mount: 'table',
  x: -100,
  y: -50,
  width: 200,
  height: 100,
  thickness: 20,
} as any);

describe('turning the board over', () => {
  const operations: any[] = [
    { id: 'a', type: 'pocket' },
    { id: 'f1', type: 'flip', flipAlong: 'y', dowels: true },
    { id: 'b', type: 'pocket' },
    { id: 'c', type: 'rest', pocketOperationId: 'a' },
    { id: 'f2', type: 'flip', flipAlong: 'x', disabled: true },
    { id: 'd', type: 'pocket' },
    { id: 'f3', type: 'flip', flipAlong: 'x' },
    { id: 'e', type: 'rest', pocketOperationId: 'a' },
  ];
  const back = (id: string) => onBack({ id }, operations);

  it('puts what’s below an odd number of flips on the back', () => {
    expect(back('a')).toBe(false);
    // Its dowel holes are drilled before it turns the board.
    expect(back('f1')).toBe(false);
    expect(back('b')).toBe(true);
    // A disabled flip doesn't turn it.
    expect(back('d')).toBe(true);
    expect(back('e')).toBe(false);
  });

  it('turns it the way the first enabled flip says, on the table only', () => {
    expect(jobFlip(operations, stock)).toBe('y');
    expect(jobFlip(operations, { ...stock, mount: 'rotary' })).toBeNull();
    expect(jobFlip(operations, { ...stock, enabled: false })).toBeNull();
    expect(jobFlip([{ id: 'a', type: 'pocket' }], stock)).toBeNull();
  });

  it('cuts each side in its own frame, flagging work on the wrong side', () => {
    const frame = (id: string) => operationFrame({ id }, operations);
    expect(frame('a')).toBe('angle 0');
    expect(frame('b')).toBe('angle 0 back');
    expect(rotationMismatch(operations[3], operations)).not.toBeNull();
    expect(rotationMismatch(operations[7], operations)).toBeNull();
  });

  it('says which side each step of the program is cut on', () => {
    expect(
      programSteps(operations, false, false, true).map((s) => [s.id, s.back]),
    ).toEqual([
      ['a', false],
      ['f1', false],
      ['b', true],
      ['c', true],
      ['d', true],
      ['f3', true],
      ['e', false],
    ]);
    // Without a flip, steps don't say.
    expect(programSteps(operations, false)[0]).toEqual({
      id: 'a',
      rotation: null,
    });
  });
});

describe('shapes on the back', () => {
  const shape: CamShape[] = [
    {
      sourceShapeId: 's',
      polygons: [
        {
          // An outline, counter-clockwise, with an arc along its top.
          vertices: [
            { x: 10, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 20, bulge: 0.5 },
            { x: 10, y: 20 },
          ],
          close: true,
        },
        { vertices: [{ x: 20, y: 10 }], close: false },
      ],
      tabs: [{ points: [{ x: 30, y: 5 }], top: -15 }],
    },
  ];

  it('mirrors them across the line the board turns over along, keeping their way round', () => {
    const along = flipShapes(shape, flipFrame(stock, 'y'));
    // Along Y, across the board's middle in X (0): X mirrored.
    expect(along[0].polygons[1].vertices[0]).toEqual({ x: -20, y: 10 });
    expect(along[0].tabs).toEqual([{ points: [{ x: -30, y: 5 }], top: -15 }]);
    expect(signedArea(along[0].polygons[0])).toBeCloseTo(
      signedArea(shape[0].polygons[0]),
      9,
    );
    const xs = along[0].polygons[0].vertices
      .map((v) => v.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([-30, -30, -10, -10]);
    // Along X, across Y = 0: Y mirrored.
    const across = flipShapes(shape, flipFrame(stock, 'x'));
    expect(across[0].polygons[1].vertices[0]).toEqual({ x: 20, y: -10 });
  });

  it('drills dowel holes on that line, in from the ends, into the spoilboard', () => {
    expect(dowelHoles(stock, 'x', 15, 6)).toEqual({
      points: [
        { x: -85, y: 0 },
        { x: 85, y: 0 },
      ],
      depth: 26,
    });
    expect(dowelHoles(stock, 'y', 10, 5)?.points).toEqual([
      { x: 0, y: -40 },
      { x: 0, y: 40 },
    ]);
    // In further than the board is long: none.
    expect(dowelHoles(stock, 'y', 60, 5)).toBeNull();
  });

  it('come out where they’re drawn once the board is back the right way up', () => {
    const axis = flipAxis(stock, 'y');
    const frame = flipFrame(stock, 'y');
    // Drawn at (30, 5), 3 deep from the back: cut at (−30, 5) with the back
    // up, which is 3 above the bottom with the front up.
    const onBoard = operationPointOnBlank(axis, 180, { x: -30, y: 5, z: -3 });
    expect(onBoard.x).toBeCloseTo(30, 9);
    expect(onBoard.y).toBeCloseTo(5, 9);
    expect(onBoard.z).toBeCloseTo(-17, 9);
    expect(frame.across).toBe(0);
  });
});

describe('G-code turning the board over', () => {
  const cut = (id: string, x: number) =>
    new GCodeBuilder()
      .sourceOperationId(id)
      .travelTo(x, 0)
      .plunge(-1)
      .carveTo(x + 10, 0);
  const program = GCodeBuilder.concatAll([
    new GCodeBuilder().side(false, 'y').concat(cut('a', 0)),
    new GCodeBuilder().side(true, 'y').concat(cut('b', 20)),
    new GCodeBuilder().side(true, 'y').concat(cut('c', 40)),
    new GCodeBuilder().side(false, 'y').concat(cut('d', 60)),
  ]);

  it('stops for it, spindle off at safe height, wherever the side changes', () => {
    const lines = program.build(DEFAULT_GCODE_OPTIONS).split('\n');
    const stops = lines.flatMap((l, i) => (l === 'M0' ? [i] : []));
    expect(stops.length).toBe(2);
    for (const at of stops) {
      const before = lines.slice(0, at);
      const lastCut = before.reduce(
        (last, l, i) => (l.startsWith('G1') ? i : last),
        -1,
      );
      expect(before.lastIndexOf('M5')).toBeGreaterThan(lastCut);
      expect(
        before.some((l) => l.includes('turn the board over along Y')),
      ).toBe(true);
      // The spindle starts again before the next cut.
      const after = lines.slice(at);
      expect(after.findIndex((l) => l.startsWith('M3'))).toBeLessThan(
        after.findIndex((l) => l.startsWith('G1')),
      );
    }
  });

  it('gives the preview the cuts on the back in its frame, saying so', () => {
    const carves = program.toPaths().filter((p) => p.type === 'carve');
    expect(
      carves.map((p) => [p.sourceOperationId, p.flip, p.rotation]),
    ).toEqual([
      ['a', undefined, undefined],
      ['b', 'y', 180],
      ['c', 'y', 180],
      ['d', undefined, undefined],
    ]);
  });
});
