import { Rotary, rotaryTop } from './rotary';
import { sameAngle, SideSurface } from './rotary-remaining';
import { Heightmap, SimulatedTool, toolProfile } from './simulate';
import { CamPoint } from './types';

/**
 * A side is only left to another angle that faces it this much (degrees)
 * more squarely: round the line between two angles' shares both cut, so no
 * seam is left between them.
 */
export const SECTOR_OVERLAP = 8;
/**
 * The other angle's bit has to come within this (mm) of a point for it to
 * be left to that angle.
 */
const REACH_TOLERANCE = 0.2;
/** A cell this near the relief's lowest (mm) is floor, not model. */
const FLOOR = 1e-3;
/**
 * The floor round the model is left to an angle that finishes the model
 * this far (mm) or more below it there…
 */
const WASTE_ABOVE = 1;
/** … where the model leans no more than this off facing that angle. */
const FACES = (60 * Math.PI) / 180;

/**
 * A relief whose model turns with the stock is finished from several
 * angles, and each of them sees most of it: left alone, every angle would
 * finish all it can reach, steep sides included — slowly, and badly, since
 * a bit leaves its worst finish on what it meets side on. This shares the
 * model out instead: each part of its surface goes to the angle that faces
 * it most squarely, of those whose bit gets there.
 *
 * `surface` is the relief as the stock turned to `angle` shows it (that
 * angle's `SideSurface.mean`), `others` the other angles it's finished at.
 * Gives where the bit, with its axis at a point, would only be finishing
 * what's another angle's: the part of the surface it comes to rest on
 * (where a drop cutter touches) faces another angle more squarely by over
 * `SECTOR_OVERLAP`, and that angle's bit reaches it. The floor the relief
 * is carved away to round the model is shared out too: it's only waste to
 * take, and an angle that finishes the model well below it there — the
 * one that looks down on the model's side — takes it on its way. Null when
 * nothing is left to another angle.
 */
export function leftToOtherAngles(
  surface: Heightmap,
  tool: SimulatedTool,
  rotary: Rotary,
  angle: number,
  others: SideSurface[],
): LeftToOthers | null {
  const sides = others.filter((o) => !sameAngle(o.angle, angle));
  if (!sides.length) {
    return null;
  }
  const { nx, ny, cell, heights } = surface;
  const alongX = rotary.along === 'x';
  const top = rotaryTop(rotary, angle);
  // Which way a turn takes what faces up (see `rotary.ts`).
  const sign = alongX ? -1 : 1;
  const frames = sides.map((side) => {
    const turn = ((side.angle - angle) * Math.PI) / 180;
    return {
      turn,
      cos: Math.cos(turn),
      sin: Math.sin(turn),
      top: rotaryTop(rotary, side.angle),
      mean: side.mean,
      /** What the bit leaves there, worked out when first asked. */
      finished: null as Heightmap | null,
    };
  });
  /** An angle (radians) as a turn either way, at most half a turn. */
  const within = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

  // Per cell: whether it's another angle's to finish.
  const left = new Uint8Array(nx * ny);
  let any = false;
  const at = (i: number, j: number) =>
    heights[
      Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))
    ];
  const overlap = (SECTOR_OVERLAP * Math.PI) / 180;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const z = heights[j * nx + i];
      const x = surface.minX + (i + 0.5) * cell;
      const y = surface.minY + (j + 0.5) * cell;
      const v = (alongX ? y : x) - rotary.across;
      const w = z + top;
      // Round the model, where it's carved away to the floor: nothing of
      // the model to face, only waste to take.
      const floor = z <= surface.bottom + FLOOR;
      // How the surface leans across the axis: its normal off straight up.
      const slope = alongX
        ? (at(i, j + 1) - at(i, j - 1)) / (2 * cell)
        : (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const facing = Math.atan(-slope);
      const here = Math.abs(facing);
      if (!floor && here <= overlap) continue;
      for (const frame of frames) {
        if (!floor && within(facing + sign * frame.turn) + overlap >= here) {
          continue;
        }
        // The point as that angle meets it.
        const v2 = alongX
          ? v * frame.cos - w * frame.sin
          : v * frame.cos + w * frame.sin;
        const w2 = alongX
          ? v * frame.sin + w * frame.cos
          : -v * frame.sin + w * frame.cos;
        const px = alongX ? x : rotary.across + v2;
        const py = alongX ? rotary.across + v2 : y;
        frame.finished ??= leftByBit(frame.mean, tool);
        const reached = heightAt(frame.finished, px, py);
        if (reached === null) continue;
        const above = w2 - frame.top - reached;
        if (floor) {
          // Waste: that angle takes it when it's well above what it
          // finishes there, and what's there is the model, facing it.
          if (above < WASTE_ABOVE) continue;
          const under = heightAt(frame.mean, px, py);
          if (under === null || under <= frame.mean.bottom + FLOOR) continue;
          const step = frame.mean.cell;
          const before = heightAt(
            frame.mean,
            alongX ? px : px - step,
            alongX ? py - step : py,
          );
          const after = heightAt(
            frame.mean,
            alongX ? px : px + step,
            alongX ? py + step : py,
          );
          if (before === null || after === null) continue;
          if (Math.abs(Math.atan((after - before) / (2 * step))) > FACES) {
            continue;
          }
        } else if (above < -REACH_TOLERANCE) {
          continue;
        }
        left[j * nx + i] = 1;
        any = true;
        break;
      }
    }
  }
  if (!any) {
    return null;
  }

  // Per cell the bit's axis is over: whether what it rests on is left.
  const contact = restsOn(surface, tool);
  const skip = new Uint8Array(nx * ny);
  for (let k = 0; k < skip.length; k++) skip[k] = left[contact[k]];
  // Not on the say of one cell: only where those round it agree.
  const sure = new Uint8Array(nx * ny);
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      let all = 1;
      for (let dj = -1; dj <= 1 && all; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!skip[(j + dj) * nx + i + di]) {
            all = 0;
            break;
          }
        }
      }
      sure[j * nx + i] = all;
    }
  }
  return { minX: surface.minX, minY: surface.minY, cell, nx, ny, left: sure };
}

/**
 * Where a relief's finishing at one angle is left to other angles: per
 * cell the bit's axis could be over, 1 where it would only be finishing
 * what's theirs (see `leftToOtherAngles`).
 */
export type LeftToOthers = {
  minX: number;
  minY: number;
  cell: number;
  nx: number;
  ny: number;
  left: Uint8Array;
};

/** Whether the bit with its axis at `p` is left to another angle. */
export function isLeft(mask: LeftToOthers, p: CamPoint): boolean {
  const i = Math.floor((p.x - mask.minX) / mask.cell);
  const j = Math.floor((p.y - mask.minY) / mask.cell);
  return (
    i >= 0 &&
    j >= 0 &&
    i < mask.nx &&
    j < mask.ny &&
    mask.left[j * mask.nx + i] === 1
  );
}

/** The cells within the bit's radius of one, and its profile over each. */
function under(cell: number, tool: SimulatedTool) {
  const r = Math.max(0, tool.diameter / 2);
  const profile = toolProfile(tool);
  const reach = Math.floor(r / cell);
  const cells: { di: number; dj: number; rise: number }[] = [];
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const d = Math.hypot(di, dj) * cell;
      if (d <= r) cells.push({ di, dj, rise: profile(d) });
    }
  }
  return cells;
}

/**
 * For each cell of `surface` the bit's axis could be over: the cell it
 * comes to rest on (where the surface, less the bit's profile, is highest
 * under it).
 */
function restsOn(surface: Heightmap, tool: SimulatedTool): Int32Array {
  const { nx, ny, heights } = surface;
  const cells = under(surface.cell, tool);
  const contact = new Int32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let best = -Infinity;
      let on = j * nx + i;
      for (const { di, dj, rise } of cells) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const rest = heights[y * nx + x] - rise;
        if (rest > best) {
          best = rest;
          on = y * nx + x;
        }
      }
      contact[j * nx + i] = on;
    }
  }
  return contact;
}

/**
 * What the bit leaves of `surface` going all over it as low as it can
 * without cutting into it: the surface itself wherever the bit fits, and
 * what it can't get into filled in.
 */
export function leftByBit(surface: Heightmap, tool: SimulatedTool): Heightmap {
  const { nx, ny, heights } = surface;
  const cells = under(surface.cell, tool);
  // Where the tip rests with the axis over each cell (the uncut top holds
  // it up beyond the map).
  const tip = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let best = -Infinity;
      for (const { di, dj, rise } of cells) {
        const x = i + di;
        const y = j + dj;
        const z =
          x < 0 || y < 0 || x >= nx || y >= ny
            ? surface.top
            : heights[y * nx + x];
        if (z - rise > best) best = z - rise;
      }
      tip[j * nx + i] = best;
    }
  }
  const left = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let lowest = Infinity;
      for (const { di, dj, rise } of cells) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const z = tip[y * nx + x] + rise;
        if (z < lowest) lowest = z;
      }
      left[j * nx + i] = lowest;
    }
  }
  return { ...surface, heights: left };
}

/** The map's height at a point, between its cells' centres; null off it. */
function heightAt(map: Heightmap, x: number, y: number): number | null {
  const { nx, ny, cell, heights } = map;
  const u = (x - map.minX) / cell - 0.5;
  const v = (y - map.minY) / cell - 0.5;
  if (u < -0.5 || v < -0.5 || u > nx - 0.5 || v > ny - 0.5) {
    return null;
  }
  const fu = Math.min(nx - 1, Math.max(0, u));
  const fv = Math.min(ny - 1, Math.max(0, v));
  const i = Math.max(0, Math.min(nx - 2, Math.floor(fu)));
  const j = Math.max(0, Math.min(ny - 2, Math.floor(fv)));
  const i1 = Math.min(nx - 1, i + 1);
  const j1 = Math.min(ny - 1, j + 1);
  const tx = fu - i;
  const ty = fv - j;
  return (
    (heights[j * nx + i] * (1 - tx) + heights[j * nx + i1] * tx) * (1 - ty) +
    (heights[j1 * nx + i] * (1 - tx) + heights[j1 * nx + i1] * tx) * ty
  );
}
