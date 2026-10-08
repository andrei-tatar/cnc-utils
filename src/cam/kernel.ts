import { CamPolygon, CamVertex } from './types';
import { KERNEL_WASM } from './kernel-wasm';

/**
 * The geometry kernel (kernel/, Rust, built to WebAssembly): region
 * booleans and offsets over polygons of lines and arcs, exact (no rounding
 * to a grid) — CavalierContours' offsets and our own boolean engine.
 *
 * Regions are closed polygons read with a fill rule; what the kernel returns
 * is clean: outlines counter-clockwise, holes clockwise, none crossing
 * another (the non-zero and even-odd rules read it the same).
 */

export type FillRule = 'even-odd' | 'non-zero' | 'positive' | 'negative';
export type BooleanOp = 'union' | 'intersection' | 'difference' | 'xor';
export type JoinType = 'round' | 'miter' | 'square';
export type EndType = 'polygon' | 'joined' | 'butt' | 'square' | 'round';

const FILL: Record<FillRule, number> = {
  'even-odd': 0,
  'non-zero': 1,
  positive: 2,
  negative: 3,
};
const OPS: Record<BooleanOp, number> = {
  union: 0,
  intersection: 1,
  difference: 2,
  xor: 3,
};
const JOINS: Record<JoinType, number> = { round: 0, miter: 1, square: 2 };
const ENDS: Record<EndType, number> = {
  polygon: 0,
  joined: 1,
  butt: 2,
  square: 3,
  round: 4,
};

type Exports = {
  memory: WebAssembly.Memory;
  kernel_alloc(count: number): number;
  kernel_free(ptr: number, count: number): void;
  kernel_result(): number;
  kernel_boolean(
    a: number,
    aLen: number,
    fillA: number,
    b: number,
    bLen: number,
    fillB: number,
    op: number,
  ): number;
  kernel_normalize(a: number, aLen: number, fill: number): number;
  kernel_offset_region(a: number, aLen: number, delta: number): number;
  kernel_inflate(
    a: number,
    aLen: number,
    delta: number,
    join: number,
    end: number,
    miterLimit: number,
    arcTolerance: number,
  ): number;
  kernel_clip_open(
    paths: number,
    pathsLen: number,
    region: number,
    regionLen: number,
    fill: number,
    inside: number,
  ): number;
  kernel_pline_offset(a: number, aLen: number, delta: number): number;
};

/**
 * Where the WebAssembly comes from: next to the page (an asset of the
 * build), or bytes handed over beforehand (Node: tests and scripts set
 * `globalThis.cncKernelWasm`).
 */
let kernel: Promise<Exports> | null = null;

/**
 * The kernel's instance, made on first use. A call that traps (a panic in
 * the kernel) can leave its memory half-updated, so the instance is then
 * dropped and the next call makes a fresh one.
 */
function instance(): Promise<Exports> {
  return (kernel ??= (async () => {
    const given = (globalThis as { cncKernelWasm?: BufferSource })
      .cncKernelWasm;
    const bytes = given ?? (await (await fetch(KERNEL_WASM)).arrayBuffer());
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Exports;
  })());
}

/** Loads the kernel (calls below do too, when needed). */
export function loadKernel(): Promise<unknown> {
  return instance();
}

function encode(polygons: CamPolygon[]): Float64Array {
  let size = 1;
  for (const p of polygons) size += 2 + 3 * p.vertices.length;
  const data = new Float64Array(size);
  data[0] = polygons.length;
  let at = 1;
  for (const p of polygons) {
    data[at++] = p.vertices.length;
    data[at++] = p.close ? 1 : 0;
    for (const v of p.vertices) {
      data[at++] = v.x;
      data[at++] = v.y;
      data[at++] = v.bulge ?? 0;
    }
  }
  return data;
}

function decode(data: Float64Array): CamPolygon[] {
  const out: CamPolygon[] = [];
  const count = data[0];
  let at = 1;
  for (let i = 0; i < count; i++) {
    const n = data[at];
    const close = data[at + 1] !== 0;
    at += 2;
    const vertices: CamVertex[] = new Array(n);
    for (let k = 0; k < n; k++, at += 3) {
      const bulge = data[at + 2];
      vertices[k] = bulge
        ? { x: data[at], y: data[at + 1], bulge }
        : { x: data[at], y: data[at + 1] };
    }
    out.push({ vertices, close });
  }
  return out;
}

/** Runs `call` on the inputs copied into the kernel's memory. */
async function run(
  inputs: CamPolygon[][],
  call: (k: Exports, args: number[]) => number,
): Promise<CamPolygon[]> {
  const k = await instance();
  const buffers = inputs.map((polygons) => {
    const data = encode(polygons);
    const ptr = k.kernel_alloc(data.length);
    new Float64Array(k.memory.buffer, ptr, data.length).set(data);
    return { ptr, len: data.length };
  });
  let trapped = false;
  try {
    const len = call(
      k,
      buffers.flatMap((b) => [b.ptr, b.len]),
    );
    // Memory may have grown during the call: view it afresh.
    return decode(
      new Float64Array(k.memory.buffer, k.kernel_result(), len).slice(),
    );
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) {
      trapped = true;
      kernel = null;
    }
    throw error;
  } finally {
    // A trapped instance is dropped, its memory with it.
    if (!trapped) {
      for (const b of buffers) k.kernel_free(b.ptr, b.len);
    }
  }
}

/** `a` combined with `b`. Open polygons are left out. */
export function booleanOperation(
  a: CamPolygon[],
  b: CamPolygon[],
  op: BooleanOp,
  fillA: FillRule = 'non-zero',
  fillB: FillRule = fillA,
): Promise<CamPolygon[]> {
  return run([a, b], (k, [ap, al, bp, bl]) =>
    k.kernel_boolean(ap, al, FILL[fillA], bp, bl, FILL[fillB], OPS[op]),
  );
}

/** Closed polygons as a clean region, read with `fill`. */
export function normalize(
  polygons: CamPolygon[],
  fill: FillRule = 'even-odd',
): Promise<CamPolygon[]> {
  return run([polygons], (k, [p, l]) => k.kernel_normalize(p, l, FILL[fill]));
}

/**
 * A clean region grown by `delta` (shrunk when negative), round corners:
 * every point of the result `|delta|` from the region's edge. Exact for
 * lines and arcs.
 */
export function offsetRegion(
  region: CamPolygon[],
  delta: number,
): Promise<CamPolygon[]> {
  if (!delta || !region.length) {
    return Promise.resolve(region);
  }
  return run([region], (k, [p, l]) => k.kernel_offset_region(p, l, delta));
}

/**
 * Paths offset as the Clipper library's InflatePaths offset them: closed
 * paths bounding a region (`polygon`) or stroked (`joined`), open paths
 * stroked with butt, square or round ends; joins round, mitered (up to
 * `miterLimit` offsets, then squared) or square. Round pieces are exact;
 * for other joins arcs are first approximated within `arcTolerance`.
 *
 * A `polygon` region is read as Clipper read it: the path with the greatest
 * y sets which way round outlines go, and areas wound that way are filled —
 * overlapping outlines merge, and a hole runs the other way round.
 */
export function inflatePaths(
  paths: CamPolygon[],
  delta: number,
  join: JoinType = 'round',
  end: EndType = 'polygon',
  miterLimit = 2,
  arcTolerance = 0,
): Promise<CamPolygon[]> {
  return run([paths], (k, [p, l]) =>
    k.kernel_inflate(
      p,
      l,
      delta,
      JOINS[join],
      ENDS[end],
      miterLimit,
      arcTolerance,
    ),
  );
}

/** The parts of open paths inside (or outside) a region. */
export function clipOpenPaths(
  paths: CamPolygon[],
  region: CamPolygon[],
  inside = true,
  fill: FillRule = 'non-zero',
): Promise<CamPolygon[]> {
  return run([paths, region], (k, [pp, pl, rp, rl]) =>
    k.kernel_clip_open(pp, pl, rp, rl, FILL[fill], inside ? 1 : 0),
  );
}

/**
 * Each path offset to its left by `delta` (right when negative), open or
 * closed, as CavalierContours' parallel offset does (round joins, pieces
 * where it would cross itself left out).
 */
export function offsetPaths(
  paths: CamPolygon[],
  delta: number,
): Promise<CamPolygon[]> {
  return run([paths], (k, [p, l]) => k.kernel_pline_offset(p, l, delta));
}
