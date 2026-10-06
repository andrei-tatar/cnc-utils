import { CamPoint } from './types';

/**
 * The outlines where `field` crosses zero (positive is inside), as closed
 * loops in sample coordinates (sample (x, y) at x, y). The field is
 * `width` × `height` samples, row by row; everything outside it counts as
 * outside, so every loop closes. Crossings are interpolated between
 * samples, so outlines come out smooth rather than stepped.
 */
export function traceContours(
  field: Float32Array,
  width: number,
  height: number,
): CamPoint[][] {
  // Padded by one sample all round.
  const W = width + 2;
  const H = height + 2;
  const value = (x: number, y: number) =>
    x < 1 || y < 1 || x > width || y > height
      ? -1
      : field[(y - 1) * width + (x - 1)];

  // Crossing points live on the grid's edges: horizontal edge (x, y)–(x+1, y)
  // has index 2·(y·W + x), vertical edge (x, y)–(x, y+1) index 2·(y·W + x)+1.
  // Each crossing joins two segments, one from each cell sharing its edge.
  const edges = 2 * W * H;
  const neighbors = new Int32Array(edges * 2).fill(-1);
  const px = new Float64Array(edges);
  const py = new Float64Array(edges);
  const seen = new Uint8Array(edges);

  const crossing = (
    edge: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => {
    if (!seen[edge]) {
      seen[edge] = 1;
      const fa = value(ax, ay);
      const fb = value(bx, by);
      const t = fa / (fa - fb);
      // Back to unpadded sample coordinates.
      px[edge] = ax + (bx - ax) * t - 1;
      py[edge] = ay + (by - ay) * t - 1;
    }
    return edge;
  };
  const link = (a: number, b: number) => {
    neighbors[a * 2 + (neighbors[a * 2] < 0 ? 0 : 1)] = b;
    neighbors[b * 2 + (neighbors[b * 2] < 0 ? 0 : 1)] = a;
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = value(x, y) > 0;
      const tr = value(x + 1, y) > 0;
      const br = value(x + 1, y + 1) > 0;
      const bl = value(x, y + 1) > 0;
      if (tl === tr && tr === br && br === bl) continue;

      const top = () => crossing(2 * (y * W + x), x, y, x + 1, y);
      const bottom = () =>
        crossing(2 * ((y + 1) * W + x), x, y + 1, x + 1, y + 1);
      const left = () => crossing(2 * (y * W + x) + 1, x, y, x, y + 1);
      const right = () =>
        crossing(2 * (y * W + x + 1) + 1, x + 1, y, x + 1, y + 1);

      if (tl === br && tr === bl) {
        // Saddle: the middle decides which corners are joined.
        const middle =
          (value(x, y) +
            value(x + 1, y) +
            value(x + 1, y + 1) +
            value(x, y + 1)) /
            4 >
          0;
        if (middle === tl) {
          // The two inside (or outside) corners tl, br are joined: cut off
          // tr and bl.
          link(top(), right());
          link(bottom(), left());
        } else {
          link(top(), left());
          link(bottom(), right());
        }
        continue;
      }
      const ends: number[] = [];
      if (tl !== tr) ends.push(top());
      if (tr !== br) ends.push(right());
      if (br !== bl) ends.push(bottom());
      if (bl !== tl) ends.push(left());
      link(ends[0], ends[1]);
    }
  }

  // Walk each loop once.
  const loops: CamPoint[][] = [];
  const done = new Uint8Array(edges);
  for (let start = 0; start < edges; start++) {
    if (!seen[start] || done[start]) continue;
    const loop: CamPoint[] = [];
    let previous = -1;
    let current = start;
    while (current >= 0 && !done[current]) {
      done[current] = 1;
      loop.push({ x: px[current], y: py[current] });
      const a = neighbors[current * 2];
      const b = neighbors[current * 2 + 1];
      const next = a !== previous ? a : b;
      previous = current;
      current = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
