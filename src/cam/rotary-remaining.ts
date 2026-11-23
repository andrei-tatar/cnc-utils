import { maxOverDisk } from './image-engrave-clearing';
import { Rotary, rotaryTop } from './rotary';
import { Heightmap } from './simulate';

/**
 * A cut made earlier in the job with the stock on its rotary axis turned
 * to `angle`, over the surface a relief has at that angle: what it's known
 * to have taken away, for later cuts at other angles to leave out.
 */
export type CutBefore = {
  angle: number;
  /** The bit's radius (mm). */
  radius: number;
  /** How far above the surface it stayed (a roughing's leave stock). */
  offset: number;
  /** For a roughing: its depth per step (it cuts level by level). */
  step?: number;
};

/** The material's top is only known this finely (mm). */
const COARSE = 0.4;

/**
 * A relief's surface as the stock turned to `angle` shows it (in that
 * angle's frame), on cells about `COARSE` across: what the cuts at other
 * angles need of it, small enough to hand to each of them. `high` is the
 * highest the surface gets over each cell (so what a cut there is sure to
 * have cleared can be read off it), `mean` its height there.
 */
export type SideSurface = { angle: number; high: Heightmap; mean: Heightmap };

/** `surface` (at `angle`) on coarse cells, for the cuts at other angles. */
export function sideSurface(surface: Heightmap, angle: number): SideSurface {
  const factor = Math.max(1, Math.round(COARSE / surface.cell));
  const nx = Math.ceil(surface.nx / factor);
  const ny = Math.ceil(surface.ny / factor);
  const high = new Float32Array(nx * ny).fill(-Infinity);
  const sum = new Float32Array(nx * ny);
  const count = new Uint16Array(nx * ny);
  for (let j = 0; j < surface.ny; j++) {
    const row = Math.floor(j / factor) * nx;
    for (let i = 0; i < surface.nx; i++) {
      const z = surface.heights[j * surface.nx + i];
      const k = row + Math.floor(i / factor);
      if (z > high[k]) high[k] = z;
      sum[k] += z;
      count[k]++;
    }
  }
  const mean = new Float32Array(nx * ny);
  for (let k = 0; k < mean.length; k++) mean[k] = sum[k] / count[k];
  const grid = { ...surface, cell: surface.cell * factor, nx, ny };
  return {
    angle,
    high: { ...grid, heights: high },
    mean: { ...grid, heights: mean },
  };
}

/** Whether two angles (degrees) turn the stock the same way up. */
export function sameAngle(a: number, b: number): boolean {
  const d = (((a - b) % 360) + 360) % 360;
  return d < 1e-6 || d > 360 - 1e-6;
}

/**
 * Above what height a cut over `surface` (the relief at its angle, in its
 * frame) is sure to have left nothing, per cell: the highest the surface
 * comes within the bit's reach — a bit gets at least that low, whatever its
 * end — and `slack` further round, plus what the cut stayed above it; for
 * a roughing, the level it stopped at there.
 */
export function clearedAbove(
  surface: Heightmap,
  cut: CutBefore,
  slack: number,
): Heightmap {
  const reach = Math.ceil((cut.radius + slack) / surface.cell);
  const heights = maxOverDisk(surface.heights, surface.nx, surface.ny, reach);
  for (let i = 0; i < heights.length; i++) {
    let z = heights[i] + cut.offset;
    if (cut.step && cut.step > 0) {
      z = -Math.floor(-z / cut.step + 1e-9) * cut.step;
    }
    heights[i] = Math.min(0, z);
  }
  return { ...surface, heights };
}

/**
 * How high material still stands over each cell of `grid` (a relief's
 * surface in the frame of a cut at `angle`: Z from the top as turned),
 * given the blank's own shape and what the cuts before (`cleared`: each
 * one's `clearedAbove`, with its angle) took away: the highest Z down to
 * `floor` where there's still material, −Infinity where there's none.
 * Worked out on a coarse grid and erring towards material: a cut may meet
 * air where this says material, never the other way.
 */
export function materialTop(
  grid: Heightmap,
  rotary: Rotary,
  angle: number,
  floor: number,
  cleared: { angle: number; above: Heightmap }[],
): Float32Array {
  const factor = Math.max(1, Math.round(COARSE / grid.cell));
  const cell = grid.cell * factor;
  const nx = Math.ceil(grid.nx / factor);
  const ny = Math.ceil(grid.ny / factor);
  const dz = cell / 2;
  const alongX = rotary.along === 'x';
  const topHere = rotaryTop(rotary, angle);
  const radians = (a: number) => (a * Math.PI) / 180;
  // To the blank at 0° (for its box), and to each earlier cut's frame.
  const home = {
    cos: Math.cos(radians(-angle)),
    sin: Math.sin(radians(-angle)),
  };
  const frames = cleared.map(({ angle: other, above }) => ({
    cos: Math.cos(radians(other - angle)),
    sin: Math.sin(radians(other - angle)),
    top: rotaryTop(rotary, other),
    above,
  }));
  // Across the axis and up from it, turned by an angle (as `rotary.ts`).
  const turn = (v: number, w: number, t: { cos: number; sin: number }) =>
    alongX
      ? [v * t.cos - w * t.sin, v * t.sin + w * t.cos]
      : [v * t.cos + w * t.sin, -v * t.sin + w * t.cos];

  const coarse = new Float32Array(nx * ny).fill(-Infinity);
  for (let j = 0; j < ny; j++) {
    const y = grid.minY + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = grid.minX + (i + 0.5) * cell;
      const along = alongX ? x : y;
      const v = (alongX ? y : x) - rotary.across;
      for (let z = 0; z >= floor - dz; z -= dz) {
        const w = z + topHere;
        if (rotary.round) {
          if (Math.hypot(v, w) > rotary.halfThickness + dz) continue;
        } else {
          const [v0, w0] = turn(v, w, home);
          if (
            Math.abs(v0) > rotary.halfWidth + dz ||
            Math.abs(w0) > rotary.halfThickness + dz
          ) {
            continue;
          }
        }
        let gone = false;
        for (const frame of frames) {
          const [vj, wj] = turn(v, w, frame);
          const { above } = frame;
          const px = alongX ? along : rotary.across + vj;
          const py = alongX ? rotary.across + vj : along;
          const ci = Math.floor((px - above.minX) / above.cell);
          const cj = Math.floor((py - above.minY) / above.cell);
          if (ci < 0 || cj < 0 || ci >= above.nx || cj >= above.ny) continue;
          // Clear of what it left by more than this is told apart.
          if (wj - frame.top > above.heights[cj * above.nx + ci] + dz) {
            gone = true;
            break;
          }
        }
        if (!gone) {
          coarse[j * nx + i] = Math.min(0, z + dz);
          break;
        }
      }
    }
  }
  // A coarse cell's neighbours count too: its own sample may miss an edge.
  const spread = maxOverDisk(coarse, nx, ny, 1);
  const top = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) {
    const row = Math.min(ny - 1, Math.floor(j / factor)) * nx;
    for (let i = 0; i < grid.nx; i++) {
      top[j * grid.nx + i] =
        spread[row + Math.min(nx - 1, Math.floor(i / factor))];
    }
  }
  return top;
}

/**
 * Whether there's material within `reach` cells of each cell, as its top
 * there (see `materialTop`): what a bit that wide over the cell could meet.
 */
export function materialWithin(
  top: Float32Array,
  grid: Heightmap,
  reach: number,
): Float32Array {
  return maxOverDisk(
    top,
    grid.nx,
    grid.ny,
    Math.max(0, Math.ceil(reach / grid.cell)),
  );
}
