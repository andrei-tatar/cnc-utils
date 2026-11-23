import { Rotary, rotaryTop, wrapDirection, wrapRadius } from './rotary';
import {
  blankHeightmap,
  Heightmap,
  SimulatedStock,
  SimulatedTool,
  simulateStock,
  toolProfile,
} from './simulate';
import { CamPath, CamPoint3 } from './types';

/**
 * The material left on a stock held on a rotary axis, as a closed surface
 * mesh in design coordinates (the stock at 0°).
 */
export type SimulatedSolid = {
  positions: Float32Array;
  index: Uint32Array;
  /** Per vertex: 0 on the stock's own faces, up to 1 at the deepest cuts. */
  shade: Float32Array;
  /** Z of its lowest point (what it stands on). */
  bottom: number;
  /** How finely it's sampled: the grid's step (mm). */
  cell: number;
};

/**
 * What the simulation leaves: a heightmap for a stock on the table, a solid
 * for one on a rotary axis.
 */
export type Simulation = Heightmap | SimulatedSolid;

/** The most grid points the solid is sampled on (memory: ~8 bytes each). */
const MAX_POINTS = 6_000_000;
/** Never finer than this (mm). */
const MIN_STEP = 0.1;

/**
 * What's left of the blank (`stock`, at 0°: the box round it, for a
 * cylinder) once every cut of `paths` is
 * made, each with the stock turned as its `rotation` says. Cuts at one angle
 * all come from above in that frame, so they leave a heightmap there
 * (`rotaryHeightmap`); the material left is what's inside the blank and
 * under every angle's heightmap (`solidUnder`).
 */
export function simulateRotaryStock(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells = 400_000,
): SimulatedSolid {
  return solidUnder(
    rotaryCuts(paths).map(({ angle, wrapped, paths: cuts }) => ({
      angle,
      ...(wrapped ? { wrapped } : {}),
      map: rotaryHeightmap(cuts, tools, rotary, stock, maxCells, {
        angle,
        wrapped,
      }),
    })),
    rotary,
    stock,
    maxCells,
  );
}

/** The cuts made with the stock turned to one angle, or wrapped from it. */
export type RotaryCuts = {
  /** Tells them apart from the cuts at other angles. */
  key: string;
  angle: number;
  wrapped?: true;
  paths: CamPath[];
};

/**
 * The cuts of `paths` by the angle the stock is turned to for them (degrees,
 * 0 – 360, in increasing order), those wrapped round it apart (after).
 */
export function rotaryCuts(paths: CamPath[]): RotaryCuts[] {
  return [...groupByAngle(paths)]
    .map(([key, group]) => ({ key, ...group }))
    .sort(
      (a, b) => Number(!!a.wrapped) - Number(!!b.wrapped) || a.angle - b.angle,
    );
}

/** The step of the grid the solid is sampled on (mm). */
function gridStep(stock: SimulatedStock, maxCells: number): number {
  const sx = stock.maxX - stock.minX;
  const sy = stock.maxY - stock.minY;
  const sz = stock.top - stock.bottom;
  return Math.max(
    MIN_STEP,
    Math.cbrt((sx * sy * sz) / Math.min(MAX_POINTS, maxCells * 4)),
  );
}

/**
 * The material left by the cuts made with the stock turned to one angle
 * (`paths`: one of `rotaryCuts`' groups): a heightmap in that angle's frame
 * over the blank as turned (`frameBlock`), or for wrapped cuts of the
 * unrolled surface (depth below it). The solid's grid reads it between its
 * cells, so those are `HEIGHTMAP_CELLS` to a grid step: finer would only
 * take longer to cut (never more than `maxCells` of them).
 */
export function rotaryHeightmap(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells: number,
  at: { angle: number; wrapped?: boolean },
): Heightmap {
  const block = at.wrapped
    ? unrolledBlock(rotary, stock)
    : frameBlock(rotary, stock, at.angle);
  const cell = gridStep(stock, maxCells) / HEIGHTMAP_CELLS;
  const area = (block.maxX - block.minX) * (block.maxY - block.minY);
  const cells = Math.max(
    1,
    Math.min(maxCells, Math.ceil(area / (cell * cell))),
  );
  if (!at.wrapped) {
    return simulateStock(paths, tools, block, cells);
  }
  // Wrapped: the bit points at the axis, and cuts the wider a way round
  // the deeper it is (see `sweepWrapped`).
  const map = blankHeightmap(block, cells);
  for (const path of paths) {
    if (path.type !== 'carve' || !path.sourceOperationId) continue;
    const tool = tools[path.sourceOperationId];
    if (!tool || !(tool.diameter > 0)) continue;
    const profile = toolProfile(tool);
    for (let i = 1; i < path.points.length; i++) {
      sweepWrapped(
        map,
        path.points[i - 1],
        path.points[i],
        tool.diameter / 2,
        profile,
        rotary,
      );
    }
  }
  for (let i = 0; i < map.heights.length; i++) {
    if (map.heights[i] < block.bottom) map.heights[i] = block.bottom;
  }
  return map;
}

/**
 * Lowers the unrolled surface of a stock on a rotary axis (`map`: depth
 * below the wrap circle) where the bit passes from `a` to `b` wrapped
 * round it. The bit points at the axis, so a cell `d` round from it is cut
 * where its own line out from the axis meets the bit: ρ cos(d) up and
 * ρ sin(d) to the side for a point ρ from the axis — deep down, the bit
 * reaches much further round than its width on the unrolled surface. (A
 * cut under material that stays — the side of a deep, straight slot — has
 * no place on an unrolled surface: only what's open to the outside is
 * taken.) Set down every half cell along the move.
 */
export function sweepWrapped(
  map: Heightmap,
  a: CamPoint3,
  b: CamPoint3,
  r: number,
  profile: (d: number) => number,
  rotary: Rotary,
) {
  if (Math.min(a.z, b.z) >= map.top) return;
  const alongX = rotary.along === 'x';
  const radius = wrapRadius(rotary);
  const round = 2 * Math.PI * radius;
  const { cell, heights } = map;
  const nAlong = alongX ? map.nx : map.ny;
  const nAcross = alongX ? map.ny : map.nx;
  const minAlong = alongX ? map.minX : map.minY;
  const minAcross = alongX ? map.minY : map.minX;
  // How many cells go round the stock once.
  const turn = Math.max(1, Math.round(round / cell));
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(length / (cell / 2)));
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    // The tip, from the axis.
    const tip = radius + a.z + (b.z - a.z) * t;
    if (tip >= radius) continue;
    const along = alongX ? x : y;
    // Within a turn of the axis line: every turn round cuts the same
    // place.
    const drawn = alongX ? y : x;
    const across = drawn - Math.round((drawn - rotary.across) / round) * round;
    // As far round as the bit's side reaches at the tip, and further out.
    const reach = Math.atan2(r, Math.max(tip, 1e-6));
    const i0 = Math.max(0, Math.floor((along - r - minAlong) / cell));
    const i1 = Math.min(nAlong - 1, Math.floor((along + r - minAlong) / cell));
    const k0 = Math.floor((across - reach * radius - minAcross) / cell);
    const k1 = Math.floor((across + reach * radius - minAcross) / cell);
    for (let k = k0; k <= k1; k++) {
      const d = (minAcross + (k + 0.5) * cell - across) / radius;
      const cos = Math.cos(d);
      const sin = Math.abs(Math.sin(d));
      if (!(cos > 1e-6)) continue;
      // The same place a whole turn on, where the map goes that far.
      const first = k - Math.floor(k / turn) * turn;
      for (let i = i0; i <= i1; i++) {
        const ahead = minAlong + (i + 0.5) * cell - along;
        // Where the cell's line out from the axis meets the bit.
        let out = tip / cos;
        let beside = 0;
        for (let pass = 0; pass < 3; pass++) {
          beside = Math.hypot(ahead, out * sin);
          if (beside > r) break;
          out = (tip + profile(beside)) / cos;
        }
        if (beside > r || Math.hypot(ahead, out * sin) > r) continue;
        const z = out - radius;
        // The line leaves the bit by its side that far out: with material
        // still beyond, a cut under it can't be told on an unrolled
        // surface, and is left out.
        const leaves =
          sin > 1e-9 ? Math.sqrt(r * r - ahead * ahead) / sin : Infinity;
        for (let row = first; row < nAcross; row += turn) {
          const at = alongX ? row * map.nx + i : i * map.nx + row;
          if (z < heights[at] && leaves >= heights[at] + radius - 1e-6) {
            heights[at] = z;
          }
        }
      }
    }
  }
}

/** How many of a heightmap's cells go in a step of the solid's grid. */
const HEIGHTMAP_CELLS = 2;

/**
 * The material inside the blank and under every one of `maps` (each angle's
 * `rotaryHeightmap`), sampled on a grid of about `maxCells` × 4 points, its
 * surface built with surface nets.
 */
export function solidUnder(
  all: { angle: number; wrapped?: true; map: Heightmap }[],
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells = 400_000,
): SimulatedSolid {
  const frames = all
    .filter((m) => !m.wrapped)
    .map(({ angle, map }) => ({
      angle,
      map,
      ...turn(angle),
      top: rotaryTop(rotary, angle),
    }));
  // Wrapped cuts: an unrolled heightmap each, read round the axis.
  const wrapped = all.filter((m) => m.wrapped);
  const r = wrapRadius(rotary);
  const circumference = 2 * Math.PI * r;

  // The grid, a step past the stock all round so its surface closes.
  const sx = stock.maxX - stock.minX;
  const sy = stock.maxY - stock.minY;
  const sz = stock.top - stock.bottom;
  const step = gridStep(stock, maxCells);
  const nx = Math.ceil(sx / step) + 3;
  const ny = Math.ceil(sy / step) + 3;
  const nz = Math.ceil(sz / step) + 3;
  const ox = stock.minX - step;
  const oy = stock.minY - step;
  const oz = stock.bottom - step;

  const { across, halfThickness } = rotary;
  const alongX = rotary.along === 'x';

  /**
   * A wrapped cut's height (depth below the wrap circle, negative) at a
   * point `along` the axis and `turned` degrees round it: the lowest over
   * every whole turn the heightmap reaches (a design going round several
   * times). Infinity where it doesn't reach.
   */
  const wrappedHeight = (
    { angle, map }: { angle: number; map: Heightmap },
    along: number,
    turned: number,
  ) => {
    const rel = ((((turned - angle + 180) % 360) + 360) % 360) - 180;
    const at = across + (wrapDirection(rotary) * rel * Math.PI * r) / 180;
    const [low, high] = alongX
      ? [map.minY, map.minY + map.ny * map.cell]
      : [map.minX, map.minX + map.nx * map.cell];
    let height = Infinity;
    const first = Math.ceil((low - at) / circumference);
    const last = Math.floor((high - at) / circumference);
    for (let k = first; k <= last; k++) {
      const unrolled = at + k * circumference;
      height = Math.min(
        height,
        alongX
          ? heightAt(map, along, unrolled)
          : heightAt(map, unrolled, along),
      );
    }
    return height;
  };

  /**
   * How far inside the material a point is (negative outside): the least
   * of how far it is inside the blank and below each angle's heightmap.
   */
  const inside = (x: number, y: number, z: number, cut?: { depth: number }) => {
    // The point relative to the axis: across it, and up from it.
    const u = (alongX ? y : x) - across;
    const w = z + halfThickness;
    let f = rotary.round
      ? // Within its length, and its radius of the axis.
        Math.min(
          alongX ? x - stock.minX : y - stock.minY,
          alongX ? stock.maxX - x : stock.maxY - y,
          halfThickness - Math.hypot(u, w),
        )
      : Math.min(
          x - stock.minX,
          stock.maxX - x,
          y - stock.minY,
          stock.maxY - y,
          z - stock.bottom,
          stock.top - z,
        );
    if (cut) cut.depth = 0;
    for (const frame of frames) {
      // Turned with the stock (see `onBlank`, which undoes this).
      const u2 = alongX
        ? u * frame.cos - w * frame.sin
        : u * frame.cos + w * frame.sin;
      const w2 = alongX
        ? u * frame.sin + w * frame.cos
        : -u * frame.sin + w * frame.cos;
      const fx = alongX ? x : across + u2;
      const fy = alongX ? across + u2 : y;
      const height = heightAt(frame.map, fx, fy);
      const below = height - (w2 - frame.top);
      if (below < f) {
        f = below;
        if (cut) cut.depth = -height / (2 * frame.top);
      }
    }
    if (wrapped.length) {
      // How far round the point is: the angle that turns it to the top.
      const turned =
        (alongX ? Math.atan2(u, w) : Math.atan2(-u, w)) * (180 / Math.PI);
      const radius = Math.hypot(u, w);
      const along = alongX ? x : y;
      for (const cuts of wrapped) {
        const height = wrappedHeight(cuts, along, turned);
        if (!Number.isFinite(height)) continue;
        const below = height - (radius - r);
        if (below < f) {
          f = below;
          if (cut) cut.depth = -height / r;
        }
      }
    }
    return f;
  };

  // The field, a line of points along the axis at a time: how far a line is
  // across the axis and up from it is the same all along it, and so is
  // where it lies across each angle's heightmap.
  const field = new Float32Array(nx * ny * nz);
  // Along the axis: how many points, where they start, and how far apart
  // they are in the field.
  const n = alongX ? nx : ny;
  const start = alongX ? ox : oy;
  const stride = alongX ? 1 : nx;
  const alongMin = alongX ? stock.minX : stock.minY;
  const alongMax = alongX ? stock.maxX : stock.maxY;
  const acrossMin = alongX ? stock.minY : stock.minX;
  const acrossMax = alongX ? stock.maxY : stock.maxX;
  const lines = alongX ? ny : nx;
  const line = new Float32Array(n);
  for (let k = 0; k < nz; k++) {
    const z = oz + k * step;
    const w = z + halfThickness;
    for (let c = 0; c < lines; c++) {
      const at = (alongX ? oy : ox) + c * step;
      const u = at - across;
      const first = alongX ? (k * ny + c) * nx : k * ny * nx + c;
      // Inside the blank, as far as that goes across the axis.
      const blank = rotary.round
        ? halfThickness - Math.hypot(u, w)
        : Math.min(
            at - acrossMin,
            acrossMax - at,
            z - stock.bottom,
            stock.top - z,
          );
      if (blank < -step) {
        // Outside, and so is every point next to these: how far isn't
        // read.
        for (let a = 0; a < n; a++) field[first + a * stride] = blank;
        continue;
      }
      for (let a = 0; a < n; a++) {
        const along = start + a * step;
        line[a] = Math.min(blank, along - alongMin, alongMax - along);
      }
      for (const frame of frames) {
        const u2 = alongX
          ? u * frame.cos - w * frame.sin
          : u * frame.cos + w * frame.sin;
        const w2 = alongX
          ? u * frame.sin + w * frame.cos
          : -u * frame.sin + w * frame.cos;
        lowerLine(
          line,
          frame.map,
          alongX,
          across + u2,
          start,
          step,
          w2 - frame.top,
        );
      }
      if (wrapped.length) {
        const turned =
          (alongX ? Math.atan2(u, w) : Math.atan2(-u, w)) * (180 / Math.PI);
        const above = Math.hypot(u, w) - r;
        for (const cuts of wrapped) {
          for (let a = 0; a < n; a++) {
            const below = wrappedHeight(cuts, start + a * step, turned) - above;
            if (below < line[a]) line[a] = below;
          }
        }
      }
      for (let a = 0; a < n; a++) field[first + a * stride] = line[a];
    }
  }

  const mesh = surfaceNets(field, nx, ny, nz);
  const positions = mesh.positions;
  const shade = new Float32Array(positions.length / 3);
  const cut = { depth: 0 };
  let bottom = Infinity;
  for (let v = 0; v < shade.length; v++) {
    const x = ox + positions[v * 3] * step;
    const y = oy + positions[v * 3 + 1] * step;
    const z = oz + positions[v * 3 + 2] * step;
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    if (z < bottom) bottom = z;
    // Within a step of a cut: shaded by its depth.
    inside(x, y, z, cut);
    shade[v] = Math.min(1, Math.max(0, cut.depth));
  }
  return {
    positions,
    index: mesh.index,
    shade,
    bottom: Number.isFinite(bottom) ? bottom : stock.bottom,
    cell: step,
  };
}

/**
 * Lowers `line` — points along the rotary axis from `start`, `step` apart,
 * all `across` in a heightmap's frame and `height` above its top — to how
 * far each is below the heightmap (what `heightAt` reads there), where
 * that's less.
 */
function lowerLine(
  line: Float32Array,
  map: Heightmap,
  alongX: boolean,
  across: number,
  start: number,
  step: number,
  height: number,
) {
  const { cell, heights } = map;
  // The heightmap's cells along the axis and across it.
  const [nAlong, nAcross] = alongX ? [map.nx, map.ny] : [map.ny, map.nx];
  const [minAlong, minAcross] = alongX
    ? [map.minX, map.minY]
    : [map.minY, map.minX];
  const [strideAlong, strideAcross] = alongX ? [1, map.nx] : [map.nx, 1];
  // Between two rows of cells across the axis, the same all along.
  const fc = Math.min(
    nAcross - 1,
    Math.max(0, (across - minAcross) / cell - 0.5),
  );
  const c0 = Math.max(0, Math.min(nAcross - 2, Math.floor(fc)));
  const tc = fc - c0;
  const row0 = c0 * strideAcross;
  const row1 = Math.min(nAcross - 1, c0 + 1) * strideAcross;
  const from = (start - minAlong) / cell - 0.5;
  const by = step / cell;
  for (let a = 0; a < line.length; a++) {
    const fa = Math.min(nAlong - 1, Math.max(0, from + a * by));
    const a0 = Math.max(0, Math.min(nAlong - 2, Math.floor(fa)));
    const ta = fa - a0;
    const i0 = a0 * strideAlong;
    const i1 = Math.min(nAlong - 1, a0 + 1) * strideAlong;
    const below =
      (heights[row0 + i0] * (1 - ta) + heights[row0 + i1] * ta) * (1 - tc) +
      (heights[row1 + i0] * (1 - ta) + heights[row1 + i1] * ta) * tc -
      height;
    if (below < line[a]) line[a] = below;
  }
}

/**
 * The cuts by how far the stock is turned for them (degrees, 0 – 360), the
 * wrapped ones apart.
 */
function groupByAngle(
  paths: CamPath[],
): Map<string, { angle: number; wrapped?: true; paths: CamPath[] }> {
  const groups = new Map<
    string,
    { angle: number; wrapped?: true; paths: CamPath[] }
  >();
  for (const path of paths) {
    if (path.type !== 'carve') continue;
    const turned = path.rotation ?? 0;
    let angle = Math.round((((turned % 360) + 360) % 360) * 1e6) / 1e6;
    if (angle === 360) angle = 0;
    const key = `${path.wrapped ? 'wrapped ' : ''}${angle}`;
    const group = groups.get(key);
    if (group) group.paths.push(path);
    else
      groups.set(key, {
        angle,
        ...(path.wrapped ? { wrapped: true as const } : {}),
        paths: [path],
      });
  }
  return groups;
}

/**
 * The surface of a round stock unrolled, as a block: along the axis as it
 * is, across it all the way round (half a turn either side of the axis
 * line, and a little over), down to the axis.
 */
function unrolledBlock(rotary: Rotary, stock: SimulatedStock): SimulatedStock {
  const alongX = rotary.along === 'x';
  // Once round and a little over: further turns cut the same places
  // (see `sweepWrapped`).
  const half = Math.PI * wrapRadius(rotary);
  const min = rotary.across - half - 10;
  const max = rotary.across + half + 10;
  return alongX
    ? {
        minX: stock.minX,
        maxX: stock.maxX,
        minY: min,
        maxY: max,
        top: 0,
        bottom: -wrapRadius(rotary),
      }
    : {
        minX: min,
        maxX: max,
        minY: stock.minY,
        maxY: stock.maxY,
        top: 0,
        bottom: -wrapRadius(rotary),
      };
}

function turn(angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

/**
 * The blank turned to `angle`, as a block in that frame: along the axis as
 * it is, across it as wide as it then is, down from its top (Z0) to its
 * bottom.
 */
export function frameBlock(
  rotary: Rotary,
  stock: SimulatedStock,
  angle: number,
): SimulatedStock {
  const top = rotaryTop(rotary, angle);
  const halfAcross = rotaryTop(rotary, angle + 90);
  const width = {
    min: rotary.across - halfAcross,
    max: rotary.across + halfAcross,
  };
  return rotary.along === 'x'
    ? {
        minX: stock.minX,
        maxX: stock.maxX,
        minY: width.min,
        maxY: width.max,
        top: 0,
        bottom: -2 * top,
      }
    : {
        minX: width.min,
        maxX: width.max,
        minY: stock.minY,
        maxY: stock.maxY,
        top: 0,
        bottom: -2 * top,
      };
}

/** The heightmap's height at (x, y), between its cells' centres. */
function heightAt(map: Heightmap, x: number, y: number): number {
  const { nx, ny, cell, heights } = map;
  const fx = Math.min(nx - 1, Math.max(0, (x - map.minX) / cell - 0.5));
  const fy = Math.min(ny - 1, Math.max(0, (y - map.minY) / cell - 0.5));
  const i = Math.min(nx - 2, Math.floor(fx));
  const j = Math.min(ny - 2, Math.floor(fy));
  if (i < 0 || j < 0) {
    // One cell across: no neighbour to blend with.
    return heights[Math.round(fy) * nx + Math.round(fx)];
  }
  const tx = fx - i;
  const ty = fy - j;
  const a = heights[j * nx + i];
  const b = heights[j * nx + i + 1];
  const c = heights[(j + 1) * nx + i];
  const d = heights[(j + 1) * nx + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** The cube's corners (x, y, z offsets) and its edges between them. */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * The surface where `field` (on an nx × ny × nz grid, x fastest; positive
 * inside) crosses 0, by surface nets: a vertex in each grid cube the
 * surface passes through, at the mean of where it crosses the cube's
 * edges, and a quad across each grid edge it crosses, facing out. In grid
 * units. The grid's outermost points must be outside.
 */
export function surfaceNets(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
): { positions: Float32Array; index: Uint32Array } {
  const cube = (i: number, j: number, k: number) =>
    i + (nx - 1) * (j + (ny - 1) * k);
  const vertexOf = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const positions: number[] = [];
  const at = (i: number, j: number, k: number) => field[i + nx * (j + ny * k)];
  const values = new Float64Array(8);

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CORNERS[c];
          values[c] = at(i + di, j + dj, k + dk);
          if (values[c] > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = values[a] / (values[a] - values[b]);
          const [ai, aj, ak] = CORNERS[a];
          const [bi, bj, bk] = CORNERS[b];
          x += ai + (bi - ai) * t;
          y += aj + (bj - aj) * t;
          z += ak + (bk - ak) * t;
          crossings++;
        }
        vertexOf[cube(i, j, k)] = positions.length / 3;
        positions.push(i + x / crossings, j + y / crossings, k + z / crossings);
      }
    }
  }

  const index: number[] = [];
  /** The quad round an edge, facing `outward` along it (+1 or -1). */
  const quad = (a: number, b: number, c: number, d: number, out: boolean) => {
    const [p, q, r, s] = [a, b, c, d].map((n) => vertexOf[n]);
    if (p < 0 || q < 0 || r < 0 || s < 0) return;
    if (out) index.push(p, q, r, p, r, s);
    else index.push(p, r, q, p, s, r);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const here = at(i, j, k) > 0;
        // Edges to the next point along x, y and z; the surface faces the
        // way it leaves the material.
        if (here !== at(i + 1, j, k) > 0) {
          quad(
            cube(i, j - 1, k - 1),
            cube(i, j, k - 1),
            cube(i, j, k),
            cube(i, j - 1, k),
            here,
          );
        }
        if (here !== at(i, j + 1, k) > 0) {
          quad(
            cube(i - 1, j, k - 1),
            cube(i - 1, j, k),
            cube(i, j, k),
            cube(i, j, k - 1),
            here,
          );
        }
        if (here !== at(i, j, k + 1) > 0) {
          quad(
            cube(i - 1, j - 1, k),
            cube(i, j - 1, k),
            cube(i, j, k),
            cube(i - 1, j, k),
            here,
          );
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    index: Uint32Array.from(index),
  };
}
