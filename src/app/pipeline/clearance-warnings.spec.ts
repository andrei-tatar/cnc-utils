import { JobWarning } from '../../cam/job-checks';
import { emptyModel, ModelType } from '../model-editor/model';
import { withClearances } from './job-checks';

describe('job checks with the moves checked against the material', () => {
  const model = {
    ...emptyModel(),
    operations: [
      { id: 'a', name: 'deep slot', type: 'pocket' },
      { id: 'b', name: 'cleared slot', type: 'pocket' },
    ],
  } as unknown as ModelType;
  const flutes = (id: string, name: string): JobWarning => ({
    level: 'warning',
    text: `${name}: goes 8 mm deep, past the bit’s 5 mm flutes`,
    operationId: id,
    kind: 'flutes',
  });
  const warnings = [flutes('a', 'deep slot'), flutes('b', 'cleared slot')];

  it('keeps the checks as they are until it’s done', () => {
    expect(withClearances(warnings, null, model)).toBe(warnings);
  });

  it('adds rapids and the collet nut, and tells cleared cuts past the flutes from those that rub', () => {
    const result = withClearances(
      warnings,
      {
        shankChecked: ['a', 'b'],
        problems: [
          {
            operationId: 'a',
            kind: 'shank',
            depth: 3,
            at: { x: 10, y: 20, z: -8 },
            count: 4,
          },
          {
            operationId: 'b',
            kind: 'rapid',
            depth: 2.04,
            at: { x: 5.2, y: 7.8, z: -2 },
            count: 2,
          },
          {
            operationId: 'a',
            kind: 'holder',
            depth: 1.5,
            at: { x: 1, y: 2, z: -20 },
            count: 1,
          },
        ],
      },
      model,
    );
    expect(result.map((w) => [w.level, w.text])).toEqual([
      [
        'warning',
        'cleared slot: a rapid move goes 2 mm into material that isn’t cut yet (2 times), near X 5 Y 8',
      ],
      [
        'warning',
        'deep slot: the collet nut comes 1.5 mm down onto the material, near X 1 Y 2: let the bit stick out further',
      ],
      [
        'warning',
        'deep slot: goes 8 mm deep, past the bit’s 5 mm flutes: uncut material rises 3 mm above them (near X 10 Y 20)',
      ],
      [
        'note',
        'cleared slot: goes 8 mm deep, past the bit’s 5 mm flutes, only where earlier cuts cleared the way above them',
      ],
    ]);
  });
});
