import { Rotary, rotaryTop, wrapDirection } from './rotary';
import {
  Heightmap,
  SimulatedStock,
  SimulatedTool,
  simulateStock,
} from './simulate';
import { CamPath } from './types';

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
 * (`simulateStock`); the material left is what's inside the blank and under
 * every angle's heightmap. That's sampled on a grid of about
 * `maxCells` × 4 points and its surface built with surface nets.
 */
export function simulateRotaryStock(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells = 400_000,
): SimulatedSolid {
  const all = rotaryHeightmaps(paths, tools, rotary, stock, maxCells);
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
  const r = rotary.halfThickness;
  const circumference = 2 * Math.PI * r;

  // The grid, a step past the stock all round so its surface closes.
  const sx = stock.maxX - stock.minX;
  const sy = stock.maxY - stock.minY;
  const sz = stock.top - stock.bottom;
  const step = Math.max(
    MIN_STEP,
    Math.cbrt((sx * sy * sz) / Math.min(MAX_POINTS, maxCells * 4)),
  );
  const nx = Math.ceil(sx / step) + 3;
  const ny = Math.ceil(sy / step) + 3;
  const nz = Math.ceil(sz / step) + 3;
  const ox = stock.minX - step;
  const oy = stock.minY - step;
  const oz = stock.bottom - step;

  const { across, halfThickness } = rotary;
  const alongX = rotary.along === 'x';

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
      for (const { angle, map } of wrapped) {
        // Its place in the unrolled surface, and every whole turn either
        // way the heightmap reaches (a design going round several times).
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

  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = oz + k * step;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * step;
      const row = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        field[row + i] = inside(ox + i * step, y, z);
      }
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
 * The material left by the cuts at each angle the stock is turned to
 * (degrees, 0 – 360, in increasing order), each a heightmap in that angle's
 * frame over the blank as turned (`frameBlock`); and by those wrapped round
 * a round stock, a heightmap each of the unrolled surface (`wrapped`, by the
 * angle the unrolling starts from; depth below the surface). What
 * `simulateRotaryStock` intersects, and what the regression harness
 * compares.
 */
export function rotaryHeightmaps(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells = 400_000,
): { angle: number; wrapped?: true; map: Heightmap }[] {
  return [...groupByAngle(paths)]
    .sort(
      ([, a], [, b]) =>
        Number(!!a.wrapped) - Number(!!b.wrapped) || a.angle - b.angle,
    )
    .map(([, { angle, wrapped, paths: group }]) => ({
      angle,
      ...(wrapped ? { wrapped } : {}),
      map: simulateStock(
        group,
        tools,
        wrapped
          ? unrolledBlock(rotary, stock, group)
          : frameBlock(rotary, stock, angle),
        maxCells,
      ),
    }));
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
 * line) and as far as `paths` go, down to the axis.
 */
function unrolledBlock(
  rotary: Rotary,
  stock: SimulatedStock,
  paths: CamPath[],
): SimulatedStock {
  const alongX = rotary.along === 'x';
  const half = Math.PI * rotary.halfThickness;
  let min = rotary.across - half;
  let max = rotary.across + half;
  for (const path of paths) {
    for (const p of path.points) {
      const across = alongX ? p.y : p.x;
      min = Math.min(min, across - 10);
      max = Math.max(max, across + 10);
    }
  }
  return alongX
    ? {
        minX: stock.minX,
        maxX: stock.maxX,
        minY: min,
        maxY: max,
        top: 0,
        bottom: -rotary.halfThickness,
      }
    : {
        minX: min,
        maxX: max,
        minY: stock.minY,
        maxY: stock.maxY,
        top: 0,
        bottom: -rotary.halfThickness,
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
