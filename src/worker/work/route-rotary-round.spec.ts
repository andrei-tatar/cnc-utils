import { GCodeBuilder } from '../../cam/gcode-builder';
import { DEFAULT_GCODE_OPTIONS } from '../../cam/gcode-options';
import { Rotary, wrapRadius } from '../../cam/rotary';
import {
  blankRadius,
  roundingLevels,
  roundingLines,
} from '../../cam/rotary-rounding';
import { routeRotaryRound, RotaryRoundOptions } from './route-rotary-round';

describe('rounding the stock on the rotary axis', () => {
  // 40 × 40 along X, its axis on Y 0.
  const square: Rotary = {
    along: 'x',
    across: 0,
    halfWidth: 20,
    halfThickness: 20,
    round: false,
  };
  const options: RotaryRoundOptions = {
    rotary: square,
    angle: 0,
    from: 0,
    to: 100,
    stockFrom: 0,
    stockTo: 100,
    diameter: 40,
    toolSize: 6,
    toolEngagement: 0.5,
    depthPerStep: 3,
    strategy: 'along',
  };

  it('knows how far out the blank reaches each way', () => {
    expect(blankRadius(square, 0)).toBeCloseTo(20, 9);
    expect(blankRadius(square, 45)).toBeCloseTo(Math.hypot(20, 20), 9);
    expect(blankRadius(square, 90)).toBeCloseTo(20, 9);
    expect(blankRadius({ ...square, round: true }, 33)).toBe(20);
  });

  it('goes down from the corners to the diameter in even levels', () => {
    const levels = roundingLevels(square, 20, 3);
    expect(levels.length).toBe(3);
    expect(levels[2]).toBeCloseTo(20, 9);
    expect(levels[0]).toBeCloseTo(
      wrapRadius(square) - (wrapRadius(square) - 20) / 3,
      9,
    );
    // Nothing to take off a blank that's that small already.
    expect(roundingLevels({ ...square, round: true }, 20, 3)).toEqual([]);
  });

  it('only cuts lines where there’s material: at a square’s corners', () => {
    const [first, , last] = roundingLevels(square, 20, 3);
    const high = roundingLines(square, 0, first, 3);
    expect(high.length).toBe(4);
    const all = Math.ceil((2 * Math.PI * first) / 3);
    expect(high.flat().length).toBeLessThan(all / 3);
    // Down at the faces, all the way round.
    const low = roundingLines(square, 0, last, 3);
    expect(low.length).toBe(1);
    expect(low[0].length).toBe(Math.ceil((2 * Math.PI * last) / 3));
  });

  it('cuts wrapped, level by level down to the diameter', async () => {
    const builder = await routeRotaryRound(options);
    const paths = builder
      .rotate(0, true)
      .concat(builder)
      .toPaths({
        ...DEFAULT_GCODE_OPTIONS,
        rotary: square,
      });
    const cuts = paths.filter((p) => p.type === 'carve');
    expect(cuts.length).toBeGreaterThan(0);
    const lowest = Math.min(...cuts.flatMap((p) => p.points.map((q) => q.z)));
    // Ø40 is 8.28 below the circle the corners turn in.
    expect(lowest).toBeCloseTo(20 - wrapRadius(square), 2);
    // The bit runs the whole length, over both ends.
    const xs = cuts.flatMap((p) => p.points.map((q) => q.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(100, 6);
  });

  it('stops the bit’s edge at a shoulder short of the stock’s end', async () => {
    const builder = await routeRotaryRound({
      ...options,
      to: 70,
      strategy: 'around',
    });
    const paths = builder.toPaths({ ...DEFAULT_GCODE_OPTIONS });
    const xs = paths
      .filter((p) => p.type === 'carve')
      .flatMap((p) => p.points.map((q) => q.x));
    expect(Math.max(...xs)).toBeCloseTo(67, 6);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
  });

  it('cuts nothing with a diameter the blank is already within', async () => {
    const builder = await routeRotaryRound({ ...options, diameter: 60 });
    expect(builder.cutBounds()).toBeNull();
  });
});
