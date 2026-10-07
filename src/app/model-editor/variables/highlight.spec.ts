import { highlight } from './highlight';

describe('highlight', () => {
  const scope = new Map([
    ['width', 100],
    ['m', 3],
  ]);
  const kinds = (text: string) =>
    highlight(text, scope)
      .filter((s) => s.kind !== 'space')
      .map((s) => `${s.text}:${s.kind}`);

  it('tells numbers, units, variables, constants and functions apart', () => {
    expect(kinds('sqrt(width) * 2cm + pi')).toEqual([
      'sqrt:function',
      '(:paren',
      'width:variable',
      '):paren',
      '*:operator',
      '2:number',
      'cm:unit',
      '+:operator',
      'pi:constant',
    ]);
    expect(kinds('1/4 in')).toEqual([
      '1:number',
      '/:operator',
      '4:number',
      'in:unit',
    ]);
  });

  it('reads a unit name only after a number', () => {
    expect(kinds('2 * m')).toEqual(['2:number', '*:operator', 'm:variable']);
    expect(kinds('2m')).toEqual(['2:number', 'm:unit']);
  });

  it('marks what it can’t read', () => {
    expect(kinds('wdith + foo(1) $ )')).toEqual([
      'wdith:unknown',
      '+:operator',
      'foo:unknown',
      '(:paren',
      '1:number',
      '):paren',
      '$:error',
      '):error',
    ]);
  });

  it('keeps every character', () => {
    const text = '  a +\tsqrt( 1e3mm ) ** 2 ';
    expect(
      highlight(text, scope)
        .map((s) => s.text)
        .join(''),
    ).toBe(text);
  });
});
