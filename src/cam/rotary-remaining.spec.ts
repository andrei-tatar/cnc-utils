import {
  clearedAbove,
  materialTop,
  sameAngle,
  sideSurface,
} from './rotary-remaining';
import { Rotary } from './rotary';
import { Heightmap } from './simulate';

describe('material left on a rotary axis', () => {
  // A Ø20 round blank along X, its axis on Y 0.
  const rotary: Rotary = {
    along: 'x',
    across: 0,
    halfWidth: 10,
    halfThickness: 10,
    round: true,
  };
  const grid = (height: number): Heightmap => ({
    minX: 0,
    minY: -15,
    cell: 0.5,
    nx: 10,
    ny: 60,
    heights: new Float32Array(600).fill(height),
    top: 0,
    bottom: -12,
  });
  /** The top over the cell at `y`, half way along. */
  const at = (top: Float32Array, y: number) =>
    top[Math.floor((y + 15) / 0.5) * 10 + 5];

  it('follows the round blank, with air beside it', () => {
    const top = materialTop(grid(-12), rotary, 0, -12, []);
    expect(at(top, 0)).toBeCloseTo(0, 6);
    // 4 below the top there (√(10² − 8²) − 10), give or take the grid.
    expect(at(top, 8)).toBeGreaterThan(-4.2);
    expect(at(top, 8)).toBeLessThan(-3);
    expect(at(top, 14)).toBe(-Infinity);
    expect(at(top, -14)).toBe(-Infinity);
  });

  it('leaves out what an earlier cut took away', () => {
    // Carved flat down to the axis from 0°: only the lower half is left.
    const flat = clearedAbove(
      grid(-10),
      { angle: 0, radius: 1, offset: 0 },
      0.5,
    );
    const after = materialTop(grid(-12), rotary, 0, -12, [
      { angle: 0, above: flat },
    ]);
    expect(at(after, 0)).toBeGreaterThan(-10.1);
    expect(at(after, 0)).toBeLessThan(-9.4);
    // Seen from 180° that half is on top, untouched…
    const behind = materialTop(grid(-12), rotary, 180, -12, [
      { angle: 0, above: flat },
    ]);
    expect(at(behind, 0)).toBeCloseTo(0, 6);
    // …and from 90° one side is gone, the other whole.
    const side = materialTop(grid(-12), rotary, 90, -12, [
      { angle: 0, above: flat },
    ]);
    const [left, right] = [at(side, -5), at(side, 5)];
    expect(Math.min(left, right)).toBe(-Infinity);
    expect(Math.max(left, right)).toBeGreaterThan(-2);
  });

  it('counts a roughing as cut down to its levels, above its leave stock', () => {
    const rough = clearedAbove(
      grid(-7),
      { angle: 0, radius: 3, offset: 0.5, step: 3 },
      0.5,
    );
    // −6.5 is reached by the level at −6.
    expect(rough.heights[305]).toBeCloseTo(-6, 6);
  });

  it('hands other angles a coarser surface: each cell’s highest and mean', () => {
    const fine: Heightmap = {
      minX: 0,
      minY: 0,
      cell: 0.1,
      nx: 8,
      ny: 4,
      heights: new Float32Array(32).fill(-2),
      top: 0,
      bottom: -5,
    };
    fine.heights[0] = -1;
    const side = sideSurface(fine, 90);
    expect(side.angle).toBe(90);
    expect(side.high.cell).toBeCloseTo(0.4, 9);
    expect([side.high.nx, side.high.ny]).toEqual([2, 1]);
    expect(side.high.heights[0]).toBeCloseTo(-1, 6);
    expect(side.mean.heights[0]).toBeCloseTo(-2 + 1 / 16, 6);
    expect(side.high.heights[1]).toBeCloseTo(-2, 6);
    expect(sameAngle(0, 360)).toBeTrue();
    expect(sameAngle(-90, 270)).toBeTrue();
    expect(sameAngle(90, 270)).toBeFalse();
  });
});
