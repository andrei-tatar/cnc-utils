import {
  operationAngles,
  operationRotation,
  rotationMismatch,
} from './rotation';
import { repeatAngles } from './operation-rotary-repeat';
import { programSteps } from '../../pipeline/gcode';

describe('rotate steps', () => {
  const operations: any[] = [
    { id: 'a', type: 'pocket' },
    { id: 'r1', type: 'rotate', angle: 90 },
    { id: 'b', type: 'pocket' },
    { id: 'r2', type: 'rotate', angle: 180, disabled: true },
    { id: 'c', type: 'rest', pocketOperationId: 'b' },
    { id: 'r3', type: 'rotate', angle: 270 },
    { id: 'd', type: 'rest', pocketOperationId: 'b' },
  ];
  const angle = (id: string) => operationRotation({ id }, operations);

  it('turn the stock for the operations below, up to the next', () => {
    expect(angle('a')).toBe(0);
    expect(angle('b')).toBe(90);
    // A disabled one doesn't turn it.
    expect(angle('c')).toBe(90);
    expect(angle('d')).toBe(270);
  });

  it('flag rest machining turned otherwise than its pocket', () => {
    expect(rotationMismatch(operations[4], operations)).toBeNull();
    expect(rotationMismatch(operations[6], operations)).toEqual(
      jasmine.objectContaining({ angles: [270], otherAngles: [90] }),
    );
  });
});

describe('rotary repeats', () => {
  it('space their angles round a turn, a set angle apart or over a range', () => {
    expect(repeatAngles({ steps: 4, spacing: 'turn' })).toEqual([
      0, 90, 180, 270,
    ]);
    expect(
      repeatAngles({
        steps: 3,
        spacing: 'step',
        startAngle: 45,
        stepAngle: 30,
      }),
    ).toEqual([45, 75, 105]);
    expect(
      repeatAngles({
        steps: 3,
        spacing: 'range',
        startAngle: 0,
        endAngle: 180,
      }),
    ).toEqual([0, 90, 180]);
    expect(repeatAngles({ steps: 1, spacing: 'range', endAngle: 90 })).toEqual([
      0,
    ]);
  });

  const operations: any[] = [
    { id: 'a', type: 'pocket' },
    {
      id: 'r',
      type: 'rotary-repeat',
      steps: 2,
      spacing: 'step',
      startAngle: 0,
      stepAngle: 90,
      operations: [
        { id: 'p', type: 'pocket' },
        { id: 'q', type: 'rest', pocketOperationId: 'p' },
        { id: 'x', type: 'profile', disabled: true },
      ],
    },
    { id: 'b', type: 'rest', pocketOperationId: 'p' },
  ];

  it('cut their operations at each angle, angle by angle', () => {
    expect(programSteps(operations, true)).toEqual([
      { id: 'a', rotation: 0 },
      { id: 'p', rotation: 0 },
      { id: 'q', rotation: 0 },
      { id: 'x', rotation: 0 },
      { id: 'p', rotation: 90 },
      { id: 'q', rotation: 90 },
      { id: 'x', rotation: 90 },
      { id: 'b', rotation: 0 },
    ]);
  });

  it('or operation by operation, and once without a rotary axis', () => {
    const byOperation = operations.map((o) =>
      o.id === 'r' ? { ...o, order: 'operation' } : o,
    );
    expect(programSteps(byOperation, true).map((s) => s.id)).toEqual([
      'a',
      'p',
      'p',
      'q',
      'q',
      'x',
      'x',
      'b',
    ]);
    expect(programSteps(operations, false)).toEqual([
      { id: 'a', rotation: null },
      { id: 'p', rotation: null },
      { id: 'q', rotation: null },
      { id: 'x', rotation: null },
      { id: 'b', rotation: null },
    ]);
  });

  it('cut nothing while disabled', () => {
    const off = operations.map((o) =>
      o.id === 'r' ? { ...o, disabled: true } : o,
    );
    expect(programSteps(off, true).map((s) => s.id)).toEqual(['a', 'b']);
    expect(operationAngles({ id: 'p' }, off)).toEqual([]);
  });

  it('flag what belongs to an operation cut in another frame', () => {
    expect(operationAngles({ id: 'q' }, operations)).toEqual([0, 90]);
    expect(
      rotationMismatch(operations[1].operations[1], operations),
    ).toBeNull();
    expect(rotationMismatch(operations[2], operations)).toEqual(
      jasmine.objectContaining({ angles: [0], otherAngles: [0, 90] }),
    );
  });
});
