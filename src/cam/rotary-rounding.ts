import { Rotary, wrapDirection, wrapRadius } from './rotary';

/**
 * How far the blank reaches from the rotary axis straight up, turned to
 * `angle` (degrees): a cylinder's radius, or for a box the way out to its
 * face (or corner) there.
 */
export function blankRadius(rotary: Rotary, angle: number): number {
  if (rotary.round) {
    return rotary.halfThickness;
  }
  const radians = (angle * Math.PI) / 180;
  const across = Math.abs(Math.sin(radians));
  const up = Math.abs(Math.cos(radians));
  return Math.min(
    across > 1e-12 ? rotary.halfWidth / across : Infinity,
    up > 1e-12 ? rotary.halfThickness / up : Infinity,
  );
}

/** A line along the axis: where it is round the stock, unrolled. */
export type RoundingLine = {
  /** Across the axis on the unrolled surface (mm). */
  across: number;
  /** The blank's surface there, below the wrap circle (0 or less). */
  top: number;
};

/**
 * Rounding a blank down to radius `level` with lines along the axis,
 * `stepover` apart round it (at that radius): the lines that meet material,
 * in runs of neighbours — a box above its faces only has some at its
 * corners, and the rest of the way round is air. One run with nothing
 * between its ends when it goes all the way round. Unrolled from `angle`
 * (see `wrappedPointOnBlank`).
 */
export function roundingLines(
  rotary: Rotary,
  angle: number,
  level: number,
  stepover: number,
): RoundingLine[][] {
  const radius = wrapRadius(rotary);
  const count = Math.max(4, Math.ceil((2 * Math.PI * level) / stepover));
  const step = 360 / count;
  const direction = wrapDirection(rotary);
  const lines: (RoundingLine | null)[] = [];
  for (let i = 0; i < count; i++) {
    const unrolled = -180 + (i + 0.5) * step;
    const turned = angle + direction * unrolled;
    // As far out as the blank gets under the line and half way to its
    // neighbours.
    const out = Math.max(
      blankRadius(rotary, turned - step / 2),
      blankRadius(rotary, turned),
      blankRadius(rotary, turned + step / 2),
    );
    lines.push(
      out > level + 1e-6
        ? {
            across: rotary.across + (unrolled * Math.PI * radius) / 180,
            top: Math.min(0, out - radius),
          }
        : null,
    );
  }
  const runs: RoundingLine[][] = [];
  let run: RoundingLine[] | null = null;
  for (const line of lines) {
    if (!line) {
      run = null;
    } else if (run) {
      run.push(line);
    } else {
      runs.push((run = [line]));
    }
  }
  return runs;
}

/** The radii to round at, from the blank's furthest out down to `target`. */
export function roundingLevels(
  rotary: Rotary,
  target: number,
  depthPerStep: number,
): number[] {
  const radius = wrapRadius(rotary);
  const depth = radius - target;
  if (!(depth > 1e-9) || !(target > 0) || !(depthPerStep > 0)) {
    return [];
  }
  const steps = Math.ceil(depth / depthPerStep - 1e-9);
  return Array.from(
    { length: steps },
    (_, k) => radius - (depth * (k + 1)) / steps,
  );
}
