import {
  evaluateExpression,
  explainExpression,
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

  it('reads lengths in units as millimetres', () => {
    expect(value('1cm')).toBe(10);
    expect(value('2.5 in')).toBeCloseTo(63.5, 10);
    expect(value('1m - 1cm')).toBe(990);
    expect(value('2 * 3cm')).toBe(60);
    expect(value('-1ft')).toBeCloseTo(-304.8, 10);
    expect(value('10thou')).toBeCloseTo(0.254, 10);
    expect(value('1e3mm')).toBe(1000);
    // A fraction of whole numbers takes the unit as a whole.
    expect(value('1/4in')).toBeCloseTo(6.35, 10);
    expect(value('3 / 8 in')).toBeCloseTo(9.525, 10);
    expect(value('a / 2cm')).toBe(0.5);
    // Units only follow numbers: a variable can have a unit's name.
    expect(evaluateExpression('2 * m', new Map([['m', 3]]))).toBe(6);
  });

  it('explains what is wrong', () => {
    expect(error('c + 1')).toBe('unknown variable “c”');
    expect(error('1 +')).toBe('incomplete expression');
    expect(error('(1 + 2')).toBe('expected “)” but found the end');
    expect(error('1 2')).toBe('unexpected “2”');
    expect(error('1km')).toBe(
      'unknown unit “km” (mm, cm, dm, m, in, ft, thou)',
    );
    expect(error('2 a')).toContain('unknown unit “a”');
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

describe('explainExpression', () => {
  const vars = new Map([['a', 10]]);
  /** Each token, the part it makes and that part's value (or error). */
  const explain = (text: string) =>
    explainExpression(text, vars).map(
      (e) =>
        `${text.slice(e.at, e.end)} | ${text.slice(e.from, e.to)} | ${
          'value' in e ? e.value : e.error.message
        }`,
    );

  it('gives every token the value of the part it makes', () => {
    expect(explain('sqrt(a * 10) + 3cm')).toEqual([
      'a | a | 10',
      '10 | 10 | 10',
      '* | a * 10 | 100',
      'sqrt | sqrt(a * 10) | 10',
      '( | sqrt(a * 10) | 10',
      ') | sqrt(a * 10) | 10',
      '3cm | 3cm | 30',
      '+ | sqrt(a * 10) + 3cm | 40',
    ]);
    expect(explain('-(1 + 1) ^ 2')).toEqual([
      '1 | 1 | 1',
      '1 | 1 | 1',
      '+ | 1 + 1 | 2',
      '( | (1 + 1) | 2',
      ') | (1 + 1) | 2',
      '2 | 2 | 2',
      '^ | (1 + 1) ^ 2 | 4',
      '- | -(1 + 1) ^ 2 | -4',
    ]);
  });

  it('says why a part has no value', () => {
    expect(explain('b + 1')).toEqual([
      'b | b | unknown variable “b”',
      '1 | 1 | 1',
      '+ | b + 1 | unknown variable “b”',
    ]);
  });

  it('explains only numbers and names in text it can’t read', () => {
    expect(explain('a * (2in +')).toEqual(['a | a | 10', '2in | 2in | 50.8']);
    expect(explain('a $')).toEqual([]);
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
