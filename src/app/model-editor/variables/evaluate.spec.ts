import { evaluateNumber, evaluateVariables, VariableType } from './evaluate';

describe('evaluateVariables', () => {
  const variable = (
    id: string,
    name: string,
    value: number | string | null,
  ): VariableType => ({ id, name, value });

  it('works them out in order, each using the ones above', () => {
    const { scope, byId } = evaluateVariables([
      variable('1', 'a', 10),
      variable('2', 'b', 'a * 3'),
      variable('3', 'c', 'sqrt(2) * b'),
    ]);
    expect(scope.get('a')).toBe(10);
    expect(scope.get('b')).toBe(30);
    expect(scope.get('c')).toBeCloseTo(42.4264, 4);
    expect(byId.get('2')).toEqual({ value: 30 });
  });

  it('only lets a variable use the ones above it', () => {
    const { byId, scope } = evaluateVariables([
      variable('1', 'a', 'b + 1'),
      variable('2', 'b', 1),
      variable('3', 'c', 'c + 1'),
    ]);
    expect(byId.get('1')).toEqual({ error: '“b” is defined further down' });
    expect(byId.get('3')).toEqual({ error: '“c” can’t use itself' });
    expect([...scope.keys()]).toEqual(['b']);
  });

  it('flags bad and repeated names, and variables using broken ones', () => {
    const { byId, scope } = evaluateVariables([
      variable('1', 'a', 1),
      variable('2', 'a', 2),
      variable('3', '2x', 3),
      variable('4', 'sqrt', 4),
      variable('5', 'broken', '1 +'),
      variable('6', 'user', 'broken * 2'),
      variable('7', 'empty', null),
    ]);
    expect(byId.get('2')?.nameError).toBe('There is already a “a” above');
    expect(byId.get('3')?.nameError).toContain('Letters');
    expect(byId.get('4')?.nameError).toBe('“sqrt” is a built-in name');
    expect(byId.get('6')).toEqual({ error: '“broken” has an error' });
    expect(byId.get('7')).toEqual({ error: 'Required' });
    expect(scope.get('a')).toBe(1);
  });

  it('evaluates number fields with them', () => {
    const variables = evaluateVariables([variable('1', 'w', 40)]);
    expect(evaluateNumber(12, variables)).toEqual({ value: 12 });
    expect(evaluateNumber('w / 2', variables)).toEqual({ value: 20 });
    expect(evaluateNumber('', variables)).toBeNull();
    expect(evaluateNumber(null, variables)).toBeNull();
    expect(evaluateNumber('h', variables)).toEqual({
      error: 'unknown variable “h”',
    });
  });
});
