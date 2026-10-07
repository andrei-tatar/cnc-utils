import { signedArea, withLeads } from './leads';
import { CamPoint } from './types';

describe('withLeads', () => {
  // A 10 × 10 square, counter-clockwise, starting mid-way along its bottom.
  const square: CamPoint[] = [
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ];

  it('arcs in and out on the outside of an outside profile', () => {
    const path = withLeads(square, 'outside', 2);
    const first = path[0];
    const last = path[path.length - 1];
    // Below the bottom edge (outside), 2 behind / ahead of the start.
    expect(first.x).toBeCloseTo(3);
    expect(first.y).toBeCloseTo(-2);
    expect(last.x).toBeCloseTo(7);
    expect(last.y).toBeCloseTo(-2);
    expect(path).toContain(square[0]);
    expect(path.every((p) => p.y <= 10 + 1e-9)).toBeTrue();
  });

  it('arcs in from the inside of an inside profile', () => {
    const path = withLeads(square, 'inside', 2);
    expect(path[0].x).toBeCloseTo(3);
    expect(path[0].y).toBeCloseTo(2);
  });

  it('follows the loop whichever way it goes round', () => {
    const clockwise = [square[0], ...square.slice(1).reverse()];
    expect(signedArea(clockwise)).toBeLessThan(0);
    const path = withLeads(clockwise, 'outside', 2);
    expect(path[0].x).toBeCloseTo(7);
    expect(path[0].y).toBeCloseTo(-2);
  });
});
