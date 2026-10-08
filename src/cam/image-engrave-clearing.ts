import { traceContours } from './marching-squares';
import { Heightmap } from './simulate';
import { CamPoint } from './types';

/**
 * The depths (positive, mm) clearing goes down to: `depthPerStep` deeper
 * each, the last at `total` (the deepest there is to clear).
 */
export function clearingLevels(total: number, depthPerStep: number): number[] {
  if (!(total > 1e-6) || !(depthPerStep > 0)) {
    return [];
  }
  const count = Math.ceil(total / depthPerStep - 1e-9);
  return Array.from({ length: count }, (_, k) =>
    Math.min(total, (k + 1) * depthPerStep),
  );
}

/**
 * The outlines (closed loops, mm) of where the surface `surface` leaves
 * is `margin` or more below Z `z`: what can be cleared down to `z` without
 * coming closer than `margin` to it. Interpolated between cell centres.
 */
export function clearableLoops(
  surface: Heightmap,
  z: number,
  margin: number,
): CamPoint[][] {
  const { minX, minY, cell, nx, ny, heights } = surface;
  const field = new Float32Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    field[i] = z - (heights[i] + margin);
  }
  return traceContours(field, nx, ny).map((loop) =>
    loop.map((p) => ({
      x: minX + (p.x + 0.5) * cell,
      y: minY + (p.y + 0.5) * cell,
    })),
  );
}

/**
 * The lowest a flat end mill of `radius` can go over `surface` without
 * cutting into it: the highest the surface comes under the bit, wherever
 * on the map the bit is lowest.
 */
export function lowestReach(surface: Heightmap, radius: number): number {
  const reach = Math.max(0, Math.round(radius / surface.cell));
  const under = maxOverDisk(surface.heights, surface.nx, surface.ny, reach);
  let lowest = surface.top;
  for (const z of under) lowest = Math.min(lowest, z);
  return lowest;
}

/**
 * The highest of `values` (rows of `nx`) within `reach` cells of each
 * cell, round: per row of the disk a sliding maximum along the rows, as
 * wide as the disk is there.
 */
export function maxOverDisk(
  values: Float32Array,
  nx: number,
  ny: number,
  reach: number,
): Float32Array {
  const out = new Float32Array(values.length).fill(-Infinity);
  const along = new Float32Array(values.length);
  const queue = new Int32Array(nx);
  for (let dy = 0; dy <= reach; dy++) {
    const half = Math.floor(Math.sqrt(reach * reach - dy * dy));
    // Each row's maximum over `half` cells either side (a monotonic queue).
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      let head = 0;
      let tail = 0;
      let next = 0;
      for (let i = 0; i < nx; i++) {
        for (; next < nx && next <= i + half; next++) {
          while (
            tail > head &&
            values[row + queue[tail - 1]] <= values[row + next]
          ) {
            tail--;
          }
          queue[tail++] = next;
        }
        while (queue[head] < i - half) head++;
        along[row + i] = values[row + queue[head]];
      }
    }
    for (let j = 0; j < ny; j++) {
      for (const from of dy ? [j - dy, j + dy] : [j]) {
        if (from < 0 || from >= ny) continue;
        const row = j * nx;
        const source = from * nx;
        for (let i = 0; i < nx; i++) {
          if (along[source + i] > out[row + i]) {
            out[row + i] = along[source + i];
          }
        }
      }
    }
  }
  return out;
}
