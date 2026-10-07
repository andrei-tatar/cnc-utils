import { suggest } from './suggest';

describe('suggest', () => {
  const scope = new Map([
    ['width', 100],
    ['wall', 6],
    ['depth', 12.34567],
  ]);
  const labels = (text: string, caret = text.length, all = false) =>
    suggest(text, caret, scope, all)?.items.map((s) => s.label) ?? [];

  it('suggests variables, constants and functions for the word typed, then those containing it', () => {
    expect(labels('w')).toEqual(['width', 'wall', 'pow(x, y)']);
    expect(labels('2 * de')).toEqual(['depth', 'deg(radians)']);
    expect(labels('sq')).toEqual(['sqrt(x)']);
    expect(labels('p')).toEqual([
      'pi',
      'pow(x, y)',
      'depth',
      'exp(x)',
      'hypot(a, b, …)',
    ]);
  });

  it('shows values and what to insert', () => {
    const completion = suggest('a + dep', 7, scope)!;
    expect(completion.from).toBe(4);
    expect(completion.to).toBe(7);
    expect(completion.items[0]).toEqual({
      kind: 'variable',
      label: 'depth',
      insert: 'depth',
      detail: '12.3457',
    });
    expect(suggest('sq', 2, scope)!.items[0].insert).toBe('sqrt(');
  });

  it('replaces the whole word the caret is in', () => {
    const completion = suggest('wixyz + 1', 2, scope)!;
    expect([completion.from, completion.to]).toEqual([0, 5]);
  });

  it('suggests units after a number', () => {
    expect(labels('10c')).toEqual(['cm']);
    expect(labels('1/4 i')).toEqual(['in']);
    expect(labels('2.5m')).toEqual(['mm', 'cm', 'dm']);
    expect(labels('x1 + w')).toEqual(['width', 'wall', 'pow(x, y)']);
  });

  it('stays quiet with nothing typed unless asked', () => {
    expect(suggest('2 * ', 4, scope)).toBeNull();
    expect(labels('2 * ', 4, true).length).toBeGreaterThan(20);
    expect(labels('2', 1, true)).toContain('cm');
    expect(suggest('width', 5, scope)).toBeNull();
  });
});
