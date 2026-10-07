import { convertDepth, depthPerStep, totalDepth } from './depth-steps';

describe('depth steps', () => {
  it('reads the depth per step, or as the total', () => {
    expect(depthPerStep({ depth: 2, steps: 3 })).toBe(2);
    expect(totalDepth({ depth: 2, steps: 3 })).toBe(6);
    expect(depthPerStep({ depthMode: 'total', depth: 6, steps: 4 })).toBe(1.5);
    expect(totalDepth({ depthMode: 'total', depth: 6, steps: 4 })).toBe(6);
  });

  it('cuts nothing without steps', () => {
    expect(depthPerStep({ depthMode: 'total', depth: 6, steps: 0 })).toBe(0);
    expect(depthPerStep({ depthMode: 'total', depth: 6, steps: null })).toBe(0);
    expect(totalDepth({ depth: 2, steps: null })).toBe(0);
  });

  it('converts the depth when the reading changes, keeping the cut', () => {
    expect(convertDepth(1.5, 4, 'total')).toBe(6);
    expect(convertDepth(0.1, 3, 'total')).toBe(0.3);
    expect(convertDepth(6, 4, 'per-step')).toBe(1.5);
    // Not a round number: kept exact as an expression.
    expect(convertDepth(5, 3, 'per-step')).toBe('5 / 3');
    expect(convertDepth('d', 2, 'total')).toBe('d * 2');
    expect(convertDepth('d + 1', 'n', 'per-step')).toBe('(d + 1) / n');
    expect(convertDepth(undefined, 2, 'total')).toBeUndefined();
    expect(convertDepth(5, 0, 'per-step')).toBeUndefined();
  });
});
