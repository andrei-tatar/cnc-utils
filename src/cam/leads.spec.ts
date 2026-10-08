import { withLeads } from './leads';
import { fromPoints, signedArea } from './arcs';
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

  it('arcs in and out on the waste side, right of the travel', () => {
    // Counter-clockwise round an outline: the waste outside is on the right.
    const path = withLeads(square, 'right', 2);
    const first = path[0];
    const last = path[path.length - 1];
    // Below the bottom edge (outside), 2 behind / ahead of the start.
    expect(first.x).toBeCloseTo(3);
    expect(first.y).toBeCloseTo(-2);
    expect(last.x).toBeCloseTo(7);
    expect(last.y).toBeCloseTo(-2);
    expect(path).toContain(square[0]);
    expect(path.every((p) => p.y <= 10 + 1e-9)).toBeTrue();
    // The leads are quarter arcs bending away from the part (clockwise
    // here, the waste on the right of a counter-clockwise loop).
    expect(first.bulge).toBeCloseTo(-Math.tan(Math.PI / 8));
    expect(path[path.length - 2].bulge).toBeCloseTo(-Math.tan(Math.PI / 8));
  });

  it('arcs in from the left, inside a counter-clockwise loop', () => {
    const path = withLeads(square, 'left', 2);
    expect(path[0].x).toBeCloseTo(3);
    expect(path[0].y).toBeCloseTo(2);
  });

  it('follows the loop whichever way it goes round', () => {
    // Clockwise round an outline: the waste outside is on the left.
    const clockwise = [square[0], ...square.slice(1).reverse()];
    expect(signedArea(fromPoints(clockwise, true))).toBeLessThan(0);
    const path = withLeads(clockwise, 'left', 2);
    expect(path[0].x).toBeCloseTo(7);
    expect(path[0].y).toBeCloseTo(-2);
  });

  it('starts half-way along a side, not at a corner, so it stays in the waste', () => {
    // Counter-clockwise from the corner, the waste inside (a hole's loop).
    const fromCorner: CamPoint[] = [
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const path = withLeads(fromCorner, 'left', 2);
    const inside = (p: CamPoint) =>
      p.x >= -1e-9 && p.x <= 10 + 1e-9 && p.y >= -1e-9 && p.y <= 10 + 1e-9;
    expect(path.every(inside)).toBeTrue();
    // In at the middle of the side leaving the corner, and out there again.
    expect(path[1]).toEqual(jasmine.objectContaining({ x: 5, y: 10 }));
    expect(path[path.length - 2]).toEqual(
      jasmine.objectContaining({ x: 5, y: 10 }),
    );
  });
});
