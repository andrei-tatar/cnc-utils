import { Bounds } from './arcs';
import { maxOverDisk } from './image-engrave-clearing';
import { Heightmap, SimulatedTool, toolProfile } from './simulate';
import { CamPoint } from './types';

/**
 * A relief's heights, row by row from the top (like an image): 0 at its
 * lowest to 1 at its highest; NaN where it has none (round a model).
 */
export type ReliefMap = { width: number; height: number; data: Float32Array };

export type ReliefOptions = {
  /** Where the map lies, in design coordinates. */
  placement: Bounds;
  /** How deep its lowest is carved (mm). */
  depth: number;
  /** Depth follows (1 − height) raised to this: above 1 raises mid-heights. */
  gamma: number;
  /** Carve the high parts deepest instead (a mould). */
  invert: boolean;
  /**
   * Inside the shape but off the map (or where it has none): left at the
   * surface, or carved away to the full depth so the relief stands on a
   * floor.
   */
  around: 'surface' | 'floor';
};

/** How deep (mm) height `h` (0 – 1) is carved. */
export function reliefDepth(
  h: number,
  options: Pick<ReliefOptions, 'depth' | 'gamma' | 'invert'>,
): number {
  const clamped = Math.min(1, Math.max(0, h));
  const tone = options.invert ? clamped : 1 - clamped;
  const gamma = options.gamma > 0 ? options.gamma : 1;
  return Math.pow(tone, gamma) * Math.max(0, options.depth);
}

/**
 * The map's height at `p` (bilinear between cell centres, leaving out those
 * with none), or NaN off the map or where its nearest cell has none.
 */
export function reliefAt(map: ReliefMap, p: CamPoint, placement: Bounds) {
  const { width: w, height: h, data } = map;
  if (
    !(w > 0 && h > 0) ||
    p.x < placement.minX ||
    p.x > placement.maxX ||
    p.y < placement.minY ||
    p.y > placement.maxY
  ) {
    return NaN;
  }
  const u = ((p.x - placement.minX) / (placement.maxX - placement.minX)) * w;
  const v = ((placement.maxY - p.y) / (placement.maxY - placement.minY)) * h;
  const nearest =
    data[
      Math.min(h - 1, Math.max(0, Math.floor(v))) * w +
        Math.min(w - 1, Math.max(0, Math.floor(u)))
    ];
  if (Number.isNaN(nearest)) {
    return NaN;
  }
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(u - 0.5)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(v - 0.5)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, u - 0.5 - x0));
  const fy = Math.min(1, Math.max(0, v - 0.5 - y0));
  let sum = 0;
  let weight = 0;
  const add = (x: number, y: number, wt: number) => {
    const value = data[y * w + x];
    if (wt > 0 && !Number.isNaN(value)) {
      sum += value * wt;
      weight += wt;
    }
  };
  add(x0, y0, (1 - fx) * (1 - fy));
  add(x1, y0, fx * (1 - fy));
  add(x0, y1, (1 - fx) * fy);
  add(x1, y1, fx * fy);
  return weight > 0 ? sum / weight : nearest;
}

/**
 * `map` blurred over about `radius` cells (two box blurs, each way), cells
 * with no height left out of it and left without.
 */
export function smoothRelief(map: ReliefMap, radius: number): ReliefMap {
  const r = Math.round(radius);
  if (!(r >= 1)) {
    return map;
  }
  const { width: w, height: h } = map;
  let data = map.data;
  for (let pass = 0; pass < 2; pass++) {
    data = boxBlur(data, w, h, r, 1, w);
    data = boxBlur(data, h, w, r, w, 1);
  }
  return { width: w, height: h, data };
}

/**
 * A running mean over `2r + 1` cells along lines of `n` cells `step` apart
 * (`count` lines, `stride` apart), NaN left out.
 */
function boxBlur(
  data: Float32Array,
  n: number,
  count: number,
  r: number,
  step: number,
  stride: number,
): Float32Array {
  const out = new Float32Array(data.length);
  for (let line = 0; line < count; line++) {
    const base = line * stride;
    let sum = 0;
    let cells = 0;
    const at = (i: number) => data[base + i * step];
    for (let i = 0; i < Math.min(n, r); i++) {
      if (!Number.isNaN(at(i))) {
        sum += at(i);
        cells++;
      }
    }
    for (let i = 0; i < n; i++) {
      const enter = i + r;
      if (enter < n && !Number.isNaN(at(enter))) {
        sum += at(enter);
        cells++;
      }
      const leave = i - r - 1;
      if (leave >= 0 && !Number.isNaN(at(leave))) {
        sum -= at(leave);
        cells--;
      }
      out[base + i * step] = Number.isNaN(at(i)) || !cells ? NaN : sum / cells;
    }
  }
  return out;
}

/**
 * The relief as a surface to carve (Z, 0 the top of the stock) on square
 * cells `cell` mm: inside `loops` (closed, even-odd) as deep as the map
 * says, off it as `around` says; outside the loops the uncut surface, at
 * least `border` mm of it all round.
 */
export function reliefSurface(
  map: ReliefMap,
  loops: CamPoint[][],
  options: ReliefOptions,
  cell: number,
  border: number,
): Heightmap {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of loops.flat()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= border;
  minY -= border;
  const nx = Math.max(1, Math.ceil((maxX + border - minX) / cell));
  const ny = Math.max(1, Math.ceil((maxY + border - minY) / cell));
  const heights = new Float32Array(nx * ny);
  const floor = -Math.max(0, options.depth);

  for (let j = 0; j < ny; j++) {
    const y = minY + (j + 0.5) * cell;
    // Where the row is inside the loops: between pairs of crossings.
    const crossings: number[] = [];
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k];
        const b = loop[(k + 1) % loop.length];
        if (a.y <= y !== b.y <= y) {
          crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let c = 0; c + 1 < crossings.length; c += 2) {
      const i0 = Math.max(0, Math.ceil((crossings[c] - minX) / cell - 0.5));
      const i1 = Math.min(
        nx - 1,
        Math.floor((crossings[c + 1] - minX) / cell - 0.5),
      );
      for (let i = i0; i <= i1; i++) {
        const p = { x: minX + (i + 0.5) * cell, y };
        const h = reliefAt(map, p, options.placement);
        heights[j * nx + i] = Number.isNaN(h)
          ? options.around === 'floor'
            ? floor
            : 0
          : -reliefDepth(h, options);
      }
    }
  }
  return { minX, minY, cell, nx, ny, heights, top: 0, bottom: floor };
}

/**
 * Where the tip of `tool` comes to rest over `surface` with its axis at a
 * point (a drop cutter): as low as it goes without its profile cutting
 * into the surface anywhere under it. The surface is known at the cell
 * centres only, so that's measured from the point itself to them (the
 * nearest cell's instead would make a line across the cells at an angle
 * jump from cell to cell), but kept no lower than it is on the cell
 * centres round the point, blended between them (bilinear): between
 * centres the bit would otherwise sink a little into a flat floor, or the
 * uncut top. Off the map the surface is uncut (0).
 */
export function dropCutter(
  surface: Heightmap,
  tool: SimulatedTool,
): (p: CamPoint) => number {
  const { cell, nx, ny, minX, minY, heights } = surface;
  const r = Math.max(0, tool.diameter / 2);
  // Cells right on the bit's edge count as under it, whichever way the
  // rounding goes: the bit's side stands straight up there, so a cell a
  // hair outside would let the tip drop by up to a radius, and the
  // simulation (which counts it in) would cut it.
  const edge = r + cell * 1e-6;
  const edge2 = edge * edge;
  // A point is within half a cell's diagonal of its nearest cell centre.
  const slack = cell * Math.SQRT1_2;
  const reach = Math.ceil((edge + slack) / cell);
  const profile = toolProfile(tool);

  /**
   * The cells that can be under the bit with its axis up to `spread` from
   * a cell's centre, round that cell, by the least its profile can rise
   * there, lowest first: once the highest the surface gets under the bit,
   * less that, can't beat what's been found, the rest can't either.
   */
  const cellsUnder = (spread: number) => {
    const offsets: Array<{ di: number; dj: number; least: number }> = [];
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        const d = Math.hypot(di, dj) * cell;
        if (d <= edge + spread) {
          offsets.push({
            di,
            dj,
            least: profile(Math.min(r, Math.max(0, d - spread))),
          });
        }
      }
    }
    offsets.sort((a, b) => a.least - b.least);
    return {
      di: Int32Array.from(offsets, (o) => o.di),
      dj: Int32Array.from(offsets, (o) => o.dj),
      least: Float64Array.from(offsets, (o) => o.least),
    };
  };
  const nearCentre = cellsUnder(0);
  const nearPoint = cellsUnder(slack);
  const highest = maxOverDisk(heights, nx, ny, reach);

  /**
   * The tip's height with its axis at (u, v), in cells from the first
   * cell's centre (`cells` reaching that far from its nearest), or
   * `atLeast` when that's higher.
   */
  const restAt = (
    u: number,
    v: number,
    cells: ReturnType<typeof cellsUnder>,
    atLeast = -Infinity,
  ) => {
    const { di, dj, least } = cells;
    const i = Math.round(u);
    const j = Math.round(v);
    if (i < 0 || j < 0 || i >= nx || j >= ny) {
      return surface.top;
    }
    const k = j * nx + i;
    // Under the bit, partly off the map: the uncut surface is there.
    const off = i < reach || j < reach || i >= nx - reach || j >= ny - reach;
    const top = off ? Math.max(highest[k], surface.top) : highest[k];
    let best = atLeast;
    for (let n = 0; n < least.length; n++) {
      if (top - least[n] <= best) break;
      const x = i + di[n];
      const y = j + dj[n];
      const d2 = ((x - u) * (x - u) + (y - v) * (y - v)) * cell * cell;
      if (d2 > edge2) continue;
      const z =
        x < 0 || y < 0 || x >= nx || y >= ny
          ? surface.top
          : heights[y * nx + x];
      const rest = z - profile(Math.min(Math.sqrt(d2), r));
      if (rest > best) best = rest;
    }
    // A bit narrower than a cell, between centres: on the nearest.
    return best === -Infinity ? heights[k] : best;
  };

  // On the cell centres, as they're needed.
  const centres = new Float64Array(nx * ny).fill(NaN);
  const atCentre = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) {
      return surface.top;
    }
    const k = j * nx + i;
    if (Number.isNaN(centres[k])) {
      centres[k] = restAt(i, j, nearCentre);
    }
    return centres[k];
  };

  return (p: CamPoint) => {
    const u = (p.x - minX) / cell - 0.5;
    const v = (p.y - minY) / cell - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = u - i;
    const fy = v - j;
    const blended =
      (1 - fx) * (1 - fy) * atCentre(i, j) +
      fx * (1 - fy) * atCentre(i + 1, j) +
      (1 - fx) * fy * atCentre(i, j + 1) +
      fx * fy * atCentre(i + 1, j + 1);
    return restAt(u, v, nearPoint, blended);
  };
}
