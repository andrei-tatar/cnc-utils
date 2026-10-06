import {
  evaluateExpression,
  ExpressionError,
  isPlainNumber,
} from './expression';

describe('evaluateExpression', () => {
  const vars = new Map([
    ['a', 10],
    ['b_2', 3],
  ]);
  const value = (text: string) => evaluateExpression(text, vars);
  const error = (text: string) => {
    try {
      evaluateExpression(text, vars);
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      return (e as Error).message;
    }
    return fail(`“${text}” should not evaluate`);
  };

  it('does arithmetic with the usual precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('2 ** 3')).toBe(8);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('7 % 4')).toBe(3);
    expect(value('1.5e2 + .5')).toBe(150.5);
  });

  it('uses variables, constants and functions', () => {
    expect(value('a * b_2')).toBe(30);
    expect(value('sqrt(2) * a')).toBeCloseTo(14.1421, 4);
    expect(value('max(a, b_2, 42)')).toBe(42);
    expect(value('cos(rad(60))')).toBeCloseTo(0.5, 10);
    expect(value('2 * pi')).toBeCloseTo(6.2832, 4);
    expect(value('atan2(1, 1)')).toBeCloseTo(Math.PI / 4, 10);
  });

  it('explains what is wrong', () => {
    expect(error('c + 1')).toBe('unknown variable “c”');
    expect(error('1 +')).toBe('incomplete expression');
    expect(error('(1 + 2')).toBe('expected “)” but found the end');
    expect(error('1 2')).toBe('unexpected “2”');
    expect(error('foo(1)')).toBe('unknown function “foo”');
    expect(error('sqrt(1, 2)')).toBe('sqrt takes 1 argument');
    expect(error('sqrt')).toBe('sqrt is a function: sqrt(…)');
    expect(error('1 / 0')).toBe('infinite (division by zero?)');
    expect(error('sqrt(-1)')).toBe('not a number');
    expect(error('a $ 2')).toBe('unexpected “$”');
    expect(error('  ')).toBe('empty expression');
  });

  it('reports which variable is unknown', () => {
    try {
      value('2 * missing');
      fail();
    } catch (e) {
      expect((e as ExpressionError).unknownName).toBe('missing');
    }
  });
});

describe('isPlainNumber', () => {
  it('tells numbers from expressions', () => {
    for (const text of ['12', '-0.5', '1.', '.5', ' 3 ', '1e3', '+2']) {
      expect(isPlainNumber(text)).withContext(text).toBeTrue();
    }
    for (const text of ['', 'a', '1+1', '2*a', '1e', '--1']) {
      expect(isPlainNumber(text)).withContext(text).toBeFalse();
    }
  });
});
