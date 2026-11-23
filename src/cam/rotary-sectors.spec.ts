import { Rotary } from './rotary';
import { SideSurface } from './rotary-remaining';
import { isLeft, leftByBit, leftToOtherAngles } from './rotary-sectors';
import { Heightmap } from './simulate';

describe('sharing a turning model out between the angles it’s finished at', () => {
  // A Ø40 blank along X, its axis on Y 0; the model a Ø30 rod on the axis:
  // from every angle the same, 5 below the top in the middle and down to
  // the axis beside it.
  const rotary: Rotary = {
    along: 'x',
    across: 0,
    halfWidth: 20,
    halfThickness: 20,
    round: true,
  };
  const rod = (): Heightmap => {
    const cell = 0.4;
    const nx = 50;
    const ny = 120;
    const heights = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const v = -24 + (j + 0.5) * cell;
      heights.fill(
        Math.abs(v) < 15 ? Math.sqrt(225 - v * v) - 20 : -20,
        j * nx,
        (j + 1) * nx,
      );
    }
    return { minX: 0, minY: -24, cell, nx, ny, heights, top: 0, bottom: -20 };
  };
  const side = (angle: number): SideSurface => ({
    angle,
    high: rod(),
    mean: rod(),
  });
  const ball = { bitType: 'ball-nose', diameter: 3 };

  it('leaves the sides to the angles that face them', () => {
    const mask = leftToOtherAngles(
      rod(),
      ball,
      rotary,
      0,
      [90, 180, 270].map(side),
    )!;
    const left = (p: { x: number; y: number }) => isLeft(mask, p);
    // On top, and well within 45° either way: this angle's.
    for (const v of [0, 5, -5, 9, -9]) {
      expect(left({ x: 10, y: v }))
        .withContext(`${v}`)
        .toBeFalse();
    }
    // Further round (over 45° and the overlap: 12 mm from the middle),
    // the angles a quarter turn away face it better.
    for (const v of [13.5, -13.5, 14.5, -14.5]) {
      expect(left({ x: 10, y: v }))
        .withContext(`${v}`)
        .toBeTrue();
    }
    // Beside the rod it's only waste, down to the floor: the angle that
    // looks down on the rod's side takes that on its way.
    expect(left({ x: 10, y: 20 })).toBeTrue();
    expect(left({ x: 10, y: -20 })).toBeTrue();
  });

  it('keeps everything with no other angle to take it', () => {
    expect(leftToOtherAngles(rod(), ball, rotary, 0, [])).toBeNull();
    expect(leftToOtherAngles(rod(), ball, rotary, 0, [side(360)])).toBeNull();
    // The far side faces none of this side better.
    expect(leftToOtherAngles(rod(), ball, rotary, 0, [side(180)])).toBeNull();
  });

  it('keeps what the other angle’s bit can’t get to', () => {
    // From 90° a wall hides the rod's side: nothing there for it to take.
    const hidden = side(90);
    hidden.mean.heights.fill(0);
    const mask = leftToOtherAngles(rod(), ball, rotary, 0, [hidden]);
    expect(!!mask && isLeft(mask, { x: 10, y: 14 })).toBeFalse();
  });

  it('works out what a bit leaves of a surface', () => {
    // A slot 2 wide, 5 deep, in a flat: a Ø3 ball doesn't get to its floor.
    const cell = 0.25;
    const nx = 80;
    const ny = 8;
    const heights = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * cell;
        heights[j * nx + i] = x > 9 && x < 11 ? -5 : 0;
      }
    }
    const left = leftByBit(
      { minX: 0, minY: 0, cell, nx, ny, heights, top: 0, bottom: -5 },
      ball,
    );
    const at = (x: number) => left.heights[4 * nx + Math.floor(x / cell)];
    expect(at(5)).toBeCloseTo(0, 6);
    expect(at(10)).toBeGreaterThan(-1);
    expect(at(10)).toBeLessThan(0);
  });
});
