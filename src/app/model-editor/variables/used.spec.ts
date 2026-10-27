import { VariableType } from './evaluate';
import { variablesUsedBy } from './used';

describe('variablesUsedBy', () => {
  const variable = (
    id: string,
    name: string,
    value: number | string | null,
  ): VariableType => ({ id, name, value });
  const variables = [
    variable('1', 'bit', '1/4in'),
    variable('2', 'unused', 3),
    variable('3', 'feed', 1200),
    variable('4', 'plunge', 'feed / 3'),
    variable('5', 'deep', 'plunge + bit'),
  ];

  it('keeps the variables the expressions use, and those those use, in order', () => {
    const tools = [{ id: 't', diameter: 'bit', plungeRate: 'plunge * 2' }];
    expect(variablesUsedBy(variables, tools).map((v) => v.name)).toEqual([
      'bit',
      'feed',
      'plunge',
    ]);
  });

  it('looks into nested settings', () => {
    const gcode = { safeHeight: 5, machineSpecs: { maxFeed: 'deep * 10' } };
    expect(variablesUsedBy(variables, gcode).map((v) => v.name)).toEqual([
      'bit',
      'feed',
      'plunge',
      'deep',
    ]);
  });

  it('keeps none when nothing uses them', () => {
    expect(variablesUsedBy(variables, [{ diameter: 6 }])).toEqual([]);
  });
});
