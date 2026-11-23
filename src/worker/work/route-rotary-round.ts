import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { Rotary, wrapRadius } from '../../cam/rotary';
import { roundingLevels, roundingLines } from '../../cam/rotary-rounding';

export type RotaryRoundOptions = {
  rotary: Rotary;
  /** The angle the stock is turned to when it starts (degrees). */
  angle: number;
  /** Along the axis: what's rounded, and where the stock ends. */
  from: number;
  to: number;
  stockFrom: number;
  stockTo: number;
  /** The diameter it's left at (mm). */
  diameter: number;
  toolSize: number;
  /** Share of the bit's diameter between passes. */
  toolEngagement: number;
  depthPerStep: number;
  /**
   * Lines along the axis, the stock turning a step between them (only
   * where there's material), or rings round it, a step along between them.
   */
  strategy: 'along' | 'around';
  rampAngle?: number | null;
  geometry?: GeometrySettings;
};

/**
 * Rounds a blank on the rotary axis with an end mill held over the axis: a
 * square one into a cylinder, or a cylinder down to a smaller one. Cut
 * wrapped (see `GCodeBuilder.rotate`): drawn on the unrolled surface, Z
 * below the wrap circle, a level at a time down to the diameter.
 */
export async function routeRotaryRound(
  options: RotaryRoundOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  const { rotary } = options;
  const bit = options.toolSize / 2;
  const stepover = options.toolSize * Math.min(1, options.toolEngagement);
  const radius = wrapRadius(rotary);
  const levels = roundingLevels(
    rotary,
    options.diameter / 2,
    options.depthPerStep,
  );
  if (!(bit > 0) || !(stepover > 0) || !levels.length) {
    return builder;
  }
  // The bit's axis runs to the stock's end where the rounding goes that
  // far (the bit over the edge), and stops its radius short of a shoulder.
  const low = Math.min(options.from, options.to);
  const high = Math.max(options.from, options.to);
  const start = low <= options.stockFrom + 1e-6 ? low : low + bit;
  const end = high >= options.stockTo - 1e-6 ? high : high - bit;
  if (!(end > start)) {
    return builder;
  }
  const alongX = rotary.along === 'x';
  const point = (along: number, across: number) =>
    alongX ? { x: along, y: across } : { x: across, y: along };
  const travelTo = (along: number, across: number) => {
    const p = point(along, across);
    builder.travelTo(p.x, p.y);
  };
  const carveTo = (along: number, across: number, z: number) => {
    const p = point(along, across);
    builder.carveTo(p.x, p.y, z);
  };
  const tan =
    options.rampAngle && options.rampAngle > 0
      ? Math.tan((options.rampAngle * Math.PI) / 180)
      : 0;
  const half = Math.PI * radius;

  let above = radius;
  levels.forEach((level, n) => {
    const z = level - radius;
    if (options.strategy === 'around') {
      // Rings: a turn one way, a step along, a turn back.
      const count = Math.max(1, Math.ceil((end - start) / stepover));
      const from = rotary.across - half;
      const to = rotary.across + half;
      // Down from the level above (or the blank's furthest out, at first).
      const top = Math.min(0, above - radius);
      builder.goToSafeHeight();
      travelTo(start, from);
      // Which side of the seam the bit is on.
      let across = from;
      if (tan > 0) {
        // Down along the first ring: gone round again, back, at depth.
        builder.plunge(top);
        carveTo(start, Math.min(to, from + (top - z) / tan), z);
        carveTo(start, to, z);
        across = to;
      } else {
        builder.plunge(z);
      }
      for (let k = 0; k <= count; k++) {
        const along = start + ((end - start) * k) / count;
        if (k) carveTo(along, across, z);
        across = across === from ? to : from;
        carveTo(along, across, z);
      }
    } else {
      // Every other level the other way round, so the axis turns back.
      const runs = roundingLines(rotary, options.angle, level, stepover);
      if (n % 2) {
        runs.reverse();
        runs.forEach((run) => run.reverse());
      }
      for (const run of runs) {
        const first = run[0];
        // The material's top there: the level above, or the blank's own
        // surface where that's lower.
        const top = Math.min(first.top, above - radius);
        builder.goToSafeHeight();
        travelTo(start, first.across);
        if (tan > 0 && top > z) {
          // Down along the first line, back along it at depth.
          builder.plunge(top);
          carveTo(Math.min(end, start + (top - z) / tan), first.across, z);
          carveTo(start, first.across, z);
        } else {
          builder.plunge(z);
        }
        run.forEach((line, k) => {
          const forward = k % 2 === 0;
          if (k) carveTo(forward ? start : end, line.across, z);
          carveTo(forward ? end : start, line.across, z);
        });
      }
    }
    above = level;
  });
  builder.goToSafeHeight();
  return builder;
}
