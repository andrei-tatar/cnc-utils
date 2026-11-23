import { Bounds } from './arcs';
import { Rotary, wrapDirection, wrapRadius } from './rotary';
import { Heightmap, SimulatedTool, toolProfile } from './simulate';
import { CamPoint } from './types';

/**
 * A 3D model carved all round as the stock turns under the bit (a relief
 * that's wrapped and whose model turns with the stock): the model is on the
 * blank as at 0°, and what's carved is how far its surface is from the
 * rotary axis, every way round it.
 *
 * It's worked out on the stock's surface unrolled, like anything wrapped
 * (see `wrappedPointOnBlank`): along the axis as it is, across it round the
 * stock, Z the depth below the wrap circle. Unrolled, a deep cut isn't the
 * shape it is on the stock, though — the nearer the axis, the less there
 * is round it — so the bit is set down on the model as it really is (see
 * `radialDropCutter`), not on the unrolled picture of it.
 */
export type UnrolledRelief = {
  /** The model unrolled: its depth below the wrap circle (0 or less). */
  surface: Heightmap;
  /** The rectangle carved, unrolled: all the way round. */
  loops: CamPoint[][];
  box: Bounds;
  /** Along the axis: where the carving starts and ends. */
  from: number;
  to: number;
};

/**
 * How far the surface of `mesh` (triangles on the blank at 0°, Z from its
 * top there) is from the rotary axis: `nAlong` cells of `cell` mm along it
 * from `alongMin`, by `nTurn` steps round it (row `k` at unrolled angle
 * −π + (k + ½) 2π / `nTurn` from `angle`, the way a wrapped design goes
 * round). The furthest the model reaches at each; NaN where it isn't.
 */
export function radialHeights(
  mesh: Float32Array,
  rotary: Rotary,
  angle: number,
  alongMin: number,
  cell: number,
  nAlong: number,
  nTurn: number,
): Float32Array {
  const out = new Float32Array(nAlong * nTurn).fill(NaN);
  const alongX = rotary.along === 'x';
  const direction = wrapDirection(rotary);
  const start = (angle * Math.PI) / 180;
  const step = (2 * Math.PI) / nTurn;
  // Across the axis, the way that comes up as the stock turns, and up
  // from it (see `operationPointInFrame`).
  const side = alongX ? 1 : -1;
  const along = new Float64Array(3);
  const v = new Float64Array(3);
  const w = new Float64Array(3);
  /** The unrolled angle (−π – π) the stock is turned by to bring it up. */
  const unrolled = (k: number) => {
    const turned = Math.atan2(v[k], w[k]);
    const a = direction * (turned - start);
    return Math.atan2(Math.sin(a), Math.cos(a));
  };
  const crossing = { along: [0, 0, 0], out: [0, 0, 0] };

  for (let t = 0; t < mesh.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = mesh[t + k * 3];
      const y = mesh[t + k * 3 + 1];
      along[k] = alongX ? x : y;
      v[k] = side * ((alongX ? y : x) - rotary.across);
      w[k] = mesh[t + k * 3 + 2] + rotary.halfThickness;
    }
    // The rows it's in: those between its corners' angles, or all of them
    // when it goes round the axis.
    const first = unrolled(0);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const d1 = wrap(unrolled(1) - first);
    const d2 = wrap(unrolled(2) - first);
    const c0 = v[0] * w[1] - v[1] * w[0];
    const c1 = v[1] * w[2] - v[2] * w[1];
    const c2 = v[2] * w[0] - v[0] * w[2];
    const round =
      (c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0);
    let low = round
      ? 0
      : Math.ceil((first + Math.min(0, d1, d2) + Math.PI) / step - 0.5);
    let high = round
      ? nTurn - 1
      : Math.floor((first + Math.max(0, d1, d2) + Math.PI) / step - 0.5);
    if (high - low >= nTurn) {
      low = 0;
      high = nTurn - 1;
    }
    for (let row = low; row <= high; row++) {
      const k = ((row % nTurn) + nTurn) % nTurn;
      // The stock turned so this row is up: where the triangle crosses
      // the plane through the axis, straight up.
      const turned = start + direction * (-Math.PI + (k + 0.5) * step);
      const cos = Math.cos(turned);
      const sin = Math.sin(turned);
      let n = 0;
      for (let e = 0; e < 3 && n < 3; e++) {
        const a = e;
        const b = (e + 1) % 3;
        const sa = v[a] * cos - w[a] * sin;
        const sb = v[b] * cos - w[b] * sin;
        if (sa === 0 || sa < 0 !== sb < 0) {
          const f = sa === sb ? 0 : sa / (sa - sb);
          const ta = v[a] * sin + w[a] * cos;
          const tb = v[b] * sin + w[b] * cos;
          crossing.along[n] = along[a] + (along[b] - along[a]) * f;
          crossing.out[n] = ta + (tb - ta) * f;
          n++;
        }
      }
      if (n < 2) continue;
      // The two furthest apart along the axis (a corner on the plane
      // counts twice).
      let p = 0;
      let q = 1;
      if (n === 3) {
        const far = (i: number, j: number) =>
          Math.abs(crossing.along[i] - crossing.along[j]) +
          Math.abs(crossing.out[i] - crossing.out[j]);
        if (far(0, 2) > far(p, q)) [p, q] = [0, 2];
        if (far(1, 2) > far(p, q)) [p, q] = [1, 2];
      }
      if (crossing.along[p] > crossing.along[q]) [p, q] = [q, p];
      const a0 = crossing.along[p];
      const a1 = crossing.along[q];
      const t0 = crossing.out[p];
      const t1 = crossing.out[q];
      // Only above the axis: below, it's the other side's.
      if (t0 <= 0 && t1 <= 0) continue;
      const put = (i: number, radius: number) => {
        if (i < 0 || i >= nAlong || !(radius > 0)) return;
        const at = k * nAlong + i;
        if (!(out[at] >= radius)) out[at] = radius;
      };
      const i0 = Math.ceil((a0 - alongMin) / cell - 0.5);
      const i1 = Math.floor((a1 - alongMin) / cell - 0.5);
      if (i1 < i0) {
        // Between two cells' centres: its highest counts for the cell
        // it's in, so thin faces across the axis aren't lost.
        put(Math.floor(((a0 + a1) / 2 - alongMin) / cell), Math.max(t0, t1));
        continue;
      }
      for (let i = Math.max(0, i0); i <= Math.min(nAlong - 1, i1); i++) {
        const f = (alongMin + (i + 0.5) * cell - a0) / (a1 - a0);
        put(i, t0 + (t1 - t0) * f);
      }
    }
  }
  return out;
}

/** What `unrolledRelief` needs to know of the relief. */
export type UnrolledReliefOptions = {
  /** The angle the unrolling starts from (the stock's, as it's turned). */
  angle: number;
  /** How far below the wrap circle is carved, at most (mm). */
  depth: number;
  /** Where the model isn't: carved to the full depth, or left uncut. */
  around: 'surface' | 'floor';
  /** Carved this far past the model's ends along the axis (mm). */
  margin: number;
  /** About the size of a cell (mm). */
  cell: number;
  /** Uncut surface kept past the carving's ends along the axis (mm). */
  border: number;
};

/**
 * `mesh` (on the blank at 0°) as a relief to carve all round the stock:
 * its surface unrolled, from the model's one end to the other along the
 * axis and `margin` past them. Null for a model with nothing in it.
 */
export function unrolledRelief(
  mesh: Float32Array,
  rotary: Rotary,
  options: UnrolledReliefOptions,
): UnrolledRelief | null {
  const alongX = rotary.along === 'x';
  let from = Infinity;
  let to = -Infinity;
  for (let i = alongX ? 0 : 1; i < mesh.length; i += 3) {
    if (mesh[i] < from) from = mesh[i];
    if (mesh[i] > to) to = mesh[i];
  }
  if (!(to > from)) {
    return null;
  }
  from -= Math.max(0, options.margin);
  to += Math.max(0, options.margin);
  const radius = wrapRadius(rotary);
  const round = 2 * Math.PI * radius;
  // Square cells that go round a whole number of times.
  const nTurn = Math.max(8, Math.round(round / options.cell));
  const cell = round / nTurn;
  const alongMin = from - options.border;
  const nAlong = Math.max(
    1,
    Math.ceil((to + options.border - alongMin) / cell),
  );
  const radial = radialHeights(
    mesh,
    rotary,
    options.angle,
    alongMin,
    cell,
    nAlong,
    nTurn,
  );
  // Never to the axis itself: nothing would be left to hold.
  const floor = -Math.min(Math.max(0, options.depth), radius - MIN_RADIUS);
  const nx = alongX ? nAlong : nTurn;
  const ny = alongX ? nTurn : nAlong;
  const heights = new Float32Array(nx * ny);
  for (let k = 0; k < nTurn; k++) {
    for (let i = 0; i < nAlong; i++) {
      const centre = alongMin + (i + 0.5) * cell;
      const r = radial[k * nAlong + i];
      const z =
        centre < from || centre > to
          ? 0
          : Number.isNaN(r)
            ? options.around === 'floor'
              ? floor
              : 0
            : Math.min(0, Math.max(floor, r - radius));
      heights[alongX ? k * nx + i : i * nx + k] = z;
    }
  }
  const across = {
    min: rotary.across - round / 2,
    max: rotary.across + round / 2,
  };
  const box: Bounds = alongX
    ? { minX: from, maxX: to, minY: across.min, maxY: across.max }
    : { minX: across.min, maxX: across.max, minY: from, maxY: to };
  return {
    surface: {
      minX: alongX ? alongMin : across.min,
      minY: alongX ? across.min : alongMin,
      cell,
      nx,
      ny,
      heights,
      top: 0,
      bottom: floor,
    },
    loops: [
      [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ],
    ],
    box,
    from,
    to,
  };
}

/** The steps `radialDropCutter` looks a bit's profile up in. */
const AHEADS = 16;
const WAYS = 90;
const WAY_STEP = Math.PI / 2 / WAYS;

/** The model is carved no nearer the axis than this (mm). */
const MIN_RADIUS = 0.5;

/**
 * Where the tip of `tool` comes to rest over an unrolled relief with its
 * axis at a point of the unrolled surface (Z below the wrap circle): as low
 * as it goes, pointing at the rotary axis, without cutting into the model
 * as it is on the stock. A cell of the unrolled surface `d` round from the
 * bit and `ρ` from the axis is really ρ sin(d) to the bit's side and
 * ρ cos(d) up: deep down, much more of the way round is under the bit than
 * the unrolled picture shows. Past the carving's ends along the axis (and
 * within the bit's reach of them) the uncut surface holds it up.
 */
export function radialDropCutter(
  relief: UnrolledRelief,
  rotary: Rotary,
  tool: SimulatedTool,
): (p: CamPoint) => number {
  const { surface, from, to } = relief;
  const alongX = rotary.along === 'x';
  const { cell, heights } = surface;
  const nAlong = alongX ? surface.nx : surface.ny;
  const nTurn = alongX ? surface.ny : surface.nx;
  const alongMin = alongX ? surface.minX : surface.minY;
  const acrossMin = alongX ? surface.minY : surface.minX;
  const radius = wrapRadius(rotary);
  const step = (2 * Math.PI) / nTurn;
  const r = Math.max(0, tool.diameter / 2);
  const edge = r + cell * 1e-6;
  const edge2 = edge * edge;
  const profile = toolProfile(tool);
  const reach = Math.ceil((edge + cell * Math.SQRT1_2) / cell);

  // From the axis, row by row round it.
  const rho = new Float32Array(nTurn * nAlong);
  for (let k = 0; k < nTurn; k++) {
    for (let i = 0; i < nAlong; i++) {
      rho[k * nAlong + i] =
        radius + heights[alongX ? k * surface.nx + i : i * surface.nx + k];
    }
  }
  // The furthest out within the bit's reach along the axis (the uncut
  // surface past the ends): a row that can't hold the bit higher is
  // passed over.
  const high = new Float32Array(nTurn * nAlong);
  for (let k = 0; k < nTurn; k++) {
    const row = k * nAlong;
    for (let i = 0; i < nAlong; i++) {
      let top = i - reach < 0 || i + reach >= nAlong ? radius : 0;
      const end = Math.min(nAlong - 1, i + reach);
      for (let n = Math.max(0, i - reach); n <= end; n++) {
        if (rho[row + n] > top) top = rho[row + n];
      }
      high[row + i] = top;
    }
  }
  const ball = tool.bitType === 'ball-nose';
  const flat = tool.bitType === 'end-mill';
  /** Where the tip rests on a point `out` from the axis, `d` round. */
  const restOn = (out: number, cos: number, sin: number, ahead: number) =>
    out * cos -
    profile(Math.min(r, Math.sqrt(out * out * sin * sin + ahead * ahead)));
  /**
   * The highest the material from the axis out to `out`, `d` round from
   * the bit and `ahead` along, holds the tip: at its end for a flat bit,
   * for a round one maybe further in, where it's nearer the bit's axis.
   */
  const highestRest = (
    out: number,
    cos: number,
    sin: number,
    ahead: number,
  ) => {
    const end = restOn(out, cos, sin, ahead);
    if (flat || sin < 1e-9) {
      return end;
    }
    if (ball) {
      // Where the ball's slope matches the way in.
      const at = (Math.sqrt(Math.max(0, r * r - ahead * ahead)) * cos) / sin;
      return at < out ? Math.max(end, restOn(at, cos, sin, ahead)) : end;
    }
    // Any other bit: looked up (see `besideAt`).
    const way = Math.atan2(sin, cos) / WAY_STEP;
    const w0 = Math.min(WAYS - 1, Math.floor(way));
    const fw = Math.min(1, way - w0);
    const off = (Math.min(r, Math.abs(ahead)) / r) * AHEADS;
    const a0 = Math.min(AHEADS - 1, Math.floor(off));
    const fa = off - a0;
    const beside =
      (besideAt[a0 * (WAYS + 1) + w0] * (1 - fw) +
        besideAt[a0 * (WAYS + 1) + w0 + 1] * fw) *
        (1 - fa) +
      (besideAt[(a0 + 1) * (WAYS + 1) + w0] * (1 - fw) +
        besideAt[(a0 + 1) * (WAYS + 1) + w0 + 1] * fw) *
        fa;
    const at = beside / sin;
    return at < out ? Math.max(end, restOn(at, cos, sin, ahead)) : end;
  };
  // For those: how far to the bit's side the material on a line in from
  // the axis holds the tip highest, by how far `ahead` along the line is
  // (0 – the bit's radius, in `AHEADS` steps) and how far round (0 – a
  // quarter turn, in `WAYS`): where going further out along the line
  // raises it as much as the bit's profile rises. The profile only
  // steepens outwards, so there's one such place, closed in on here once;
  // between the entries the tip's height hardly changes.
  const besideAt = new Float32Array((AHEADS + 1) * (WAYS + 1));
  if (!ball && !flat) {
    for (let ia = 0; ia <= AHEADS; ia++) {
      const ahead = (ia / AHEADS) * r;
      const widest = Math.sqrt(Math.max(0, r * r - ahead * ahead));
      for (let iw = 1; iw <= WAYS; iw++) {
        const slope = 1 / Math.tan(Math.min(iw * WAY_STEP, Math.PI / 2 - 1e-9));
        const rest = (x: number) =>
          x * slope - profile(Math.min(r, Math.hypot(ahead, x)));
        let low = 0;
        let high = widest;
        for (let n = 0; n < 40; n++) {
          const p = low + (high - low) / 3;
          const q = high - (high - low) / 3;
          if (rest(p) < rest(q)) low = p;
          else high = q;
        }
        besideAt[ia * (WAYS + 1) + iw] = (low + high) / 2;
      }
      // Straight under the bit, the further out the higher.
      besideAt[ia * (WAYS + 1)] = widest;
    }
  }

  /** The bit's profile each cell along from its axis (set per point). */
  const risen = new Float64Array(2 * reach + 1);
  // A quarter of the way round at most is ever under the bit.
  const quarter = Math.floor(nTurn / 4);
  const at = (k: number, i: number) =>
    i < 0 || i >= nAlong
      ? radius
      : rho[(((k % nTurn) + nTurn) % nTurn) * nAlong + i];

  return (p: CamPoint) => {
    const along = alongX ? p.x : p.y;
    const across = alongX ? p.y : p.x;
    // Past the ends, or within reach of them: the uncut surface.
    const away = Math.min(along - from, to - along);
    if (away <= 0) {
      return 0;
    }
    const kept = away <= edge ? radius - profile(Math.min(away, r)) : -Infinity;
    const u = (along - alongMin) / cell - 0.5;
    const t = (across - acrossMin) / cell - 0.5;
    const i0 = Math.floor(u);
    const k0 = Math.floor(t);
    const fu = u - i0;
    const ft = t - k0;
    const under =
      (1 - fu) * (1 - ft) * at(k0, i0) +
      fu * (1 - ft) * at(k0, i0 + 1) +
      (1 - fu) * ft * at(k0 + 1, i0) +
      fu * ft * at(k0 + 1, i0 + 1);
    let best = Math.max(under, kept);
    const i = Math.round(u);
    const k = Math.round(t);
    for (let n = -reach; n <= reach; n++) {
      const ahead = Math.abs(i + n - u) * cell;
      risen[n + reach] = ahead > edge ? Infinity : profile(Math.min(ahead, r));
    }
    for (let m = 0; m <= quarter; m++) {
      for (let way = m ? -1 : 1; way <= 1; way += 2) {
        // How far round this row is from the bit's axis.
        const d = (k + way * m - t) * step;
        const cos = Math.cos(d);
        const sin = Math.abs(Math.sin(d));
        if (!(cos > 0)) continue;
        const row = ((((k + way * m) % nTurn) + nTurn) % nTurn) * nAlong;
        const top = i < 0 || i >= nAlong ? radius : high[row + i];
        if (top * cos <= best) continue;
        // The most the row could hold the tip up: its furthest out, right
        // across from the bit's axis.
        if (
          highestRest(top * sin > edge ? edge / sin : top, cos, sin, 0) <= best
        ) {
          continue;
        }
        for (let n = i - reach; n <= i + reach; n++) {
          let out = n < 0 || n >= nAlong ? radius : rho[row + n];
          // No higher than its end less what the bit rises that far
          // along, wherever it's across.
          if (out * cos - risen[n - i + reach] <= best) continue;
          // All the way in from there is material, and nearer the axis
          // it's nearer the bit's own: what's under the bit of it.
          const ahead = (n - u) * cell;
          const room = edge2 - ahead * ahead;
          if (room < 0) continue;
          if (out * sin > Math.sqrt(room)) out = Math.sqrt(room) / sin;
          const rest = highestRest(out, cos, sin, ahead);
          if (rest > best) best = rest;
        }
      }
      // Further round, nothing within the bit's width stands this high.
      const next = (m + 0.5) * step;
      if (edge * Math.cos(next) <= best * Math.sin(next)) break;
    }
    return Math.min(0, best - radius);
  };
}

/**
 * Where the tip of `tool` rests over each cell of an unrolled relief (see
 * `radialDropCutter`), as a surface: the lowest its axis may go there.
 */
export function radialTipSurface(
  relief: UnrolledRelief,
  rotary: Rotary,
  tool: SimulatedTool,
): Heightmap {
  const { surface } = relief;
  const tip = radialDropCutter(relief, rotary, tool);
  const heights = new Float32Array(surface.nx * surface.ny);
  for (let j = 0; j < surface.ny; j++) {
    const y = surface.minY + (j + 0.5) * surface.cell;
    for (let i = 0; i < surface.nx; i++) {
      heights[j * surface.nx + i] = tip({
        x: surface.minX + (i + 0.5) * surface.cell,
        y,
      });
    }
  }
  return { ...surface, heights };
}
