import Delaunator from 'delaunator';
import { CamPoint } from './types';

/** A point on the medial axis, with its distance to the nearest edge. */
export type AxisPoint = CamPoint & { d: number };

/**
 * The medial axis of a region (normalized contours: outlines and holes): the
 * points with two or more nearest edges, i.e. the centre line that a V-bit
 * follows to carve the region in a single pass. It reaches into convex
 * corners (where `d` goes to 0) and stays away from concave ones.
 *
 * Built from the Voronoi diagram of points `spacing` apart along the edges.
 * Each connected part is returned as one walk through it, depth first, going
 * back along branches it has already walked rather than jumping (so a tool
 * following it never has to lift). `d` is the exact distance to the edges,
 * not to the sample points.
 */
export function medialAxis(
  region: CamPoint[][],
  spacing: number,
  /**
   * Branches running into corners of the region are only kept for corners
   * this sharp or sharper (interior angle, radians); null keeps none. The
   * axis of a curve approximated by a polygon has a branch to every vertex:
   * left out, they leave next to nothing uncut.
   */
  sharpCornerAngle: number | null,
): AxisPoint[][] {
  const samples = sampleContours(region, spacing);
  if (samples.length < 3) {
    return [];
  }
  const inside = new RegionTester(region);
  const distance = new EdgeDistance(region);

  const delaunay = Delaunator.from(
    samples,
    (p) => p.x,
    (p) => p.y,
  );
  const { triangles, halfedges } = delaunay;

  // Voronoi vertices: the triangles' circumcenters, where inside the region.
  const triangleCount = triangles.length / 3;
  const centers: Array<CamPoint | null> = [];
  for (let t = 0; t < triangleCount; t++) {
    const c = circumcenter(
      samples[triangles[3 * t]],
      samples[triangles[3 * t + 1]],
      samples[triangles[3 * t + 2]],
    );
    centers.push(c && inside.contains(c) ? c : null);
  }

  // Voronoi edges between inside vertices. The edge between two neighbouring
  // samples on the same contour only separates two halves of one edge, not
  // two different edges, so it isn't part of the axis.
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  for (let e = 0; e < halfedges.length; e++) {
    const opposite = halfedges[e];
    if (opposite < e) {
      continue; // each pair once; -1 is the hull
    }
    const t1 = Math.floor(e / 3);
    const t2 = Math.floor(opposite / 3);
    if (!centers[t1] || !centers[t2]) {
      continue;
    }
    const a = samples[triangles[e]];
    const b = samples[triangles[e % 3 === 2 ? e - 2 : e + 1]];
    if (a.contour === b.contour) {
      const gap = Math.abs(a.index - b.index);
      if (gap <= 1 || gap === a.count - 1) {
        continue;
      }
    }
    link(t1, t2);
    link(t2, t1);
  }

  pruneCornerBranches(
    adjacency,
    centers,
    region,
    sharpCornerAngle,
    Math.max(0.5, 5 * spacing),
  );

  // Walk each connected part depth first, from a leaf (an end of a branch)
  // where there is one; then subdivide and measure the walk.
  const walked = new Set<string>();
  const visited = new Set<number>();
  const result: AxisPoint[][] = [];
  const nodes = [...adjacency.keys()].sort(
    (a, b) => adjacency.get(a)!.length - adjacency.get(b)!.length,
  );
  for (const start of nodes) {
    if (!visited.has(start)) {
      const walk = depthFirstWalk(start, adjacency, walked, visited);
      result.push(
        measure(
          walk.map((t) => centers[t]!),
          spacing,
          distance,
        ),
      );
    }
  }
  return result;
}

/**
 * Remove the branches (from an end to the first fork) that run into corners
 * that aren't sharp enough, or that don't run into a corner at all (noise
 * from sampling). Branches are only removed back to a fork, so the axis
 * between forks always stays; a part that is a single node is kept as is.
 */
function pruneCornerBranches(
  adjacency: Map<number, number[]>,
  centers: Array<CamPoint | null>,
  region: CamPoint[][],
  sharpCornerAngle: number | null,
  angleSpan: number,
) {
  const corners = convexCorners(region, angleSpan);
  const leaves = [...adjacency.keys()].filter(
    (n) => adjacency.get(n)!.length === 1,
  );
  const cut = (a: number, b: number) => {
    adjacency.set(
      a,
      adjacency.get(a)!.filter((n) => n !== b),
    );
    adjacency.set(
      b,
      adjacency.get(b)!.filter((n) => n !== a),
    );
  };
  // Find every branch on the axis as it is, before removing any: removing
  // one can make its fork a plain point on the axis, and the next branch
  // would then run on along the axis.
  const doomed: number[][] = [];
  for (const leaf of leaves) {
    // Follow the branch to its fork.
    const chain = [leaf];
    let previous = leaf;
    let current = adjacency.get(leaf)![0];
    while (adjacency.get(current)!.length === 2) {
      chain.push(current);
      const next = adjacency.get(current)!.find((n) => n !== previous)!;
      previous = current;
      current = next;
    }
    if (adjacency.get(current)!.length < 3) {
      continue; // a single path from end to end: that's all there is
    }
    // The corner the branch runs into: the nearest one to its end.
    const end = centers[leaf]!;
    let corner: { angle: number; distance: number } | null = null;
    for (const c of corners) {
      const distance = Math.hypot(c.x - end.x, c.y - end.y);
      if (!corner || distance < corner.distance) {
        corner = { angle: c.angle, distance };
      }
    }
    const intoCorner = corner && corner.distance <= angleSpan;
    if (
      intoCorner &&
      sharpCornerAngle !== null &&
      corner!.angle <= sharpCornerAngle
    ) {
      continue;
    }
    doomed.push([...chain, current]);
  }
  for (const chain of doomed) {
    for (let i = 1; i < chain.length; i++) {
      cut(chain[i - 1], chain[i]);
    }
    for (const n of chain.slice(0, -1)) {
      adjacency.delete(n);
    }
  }
}

/**
 * The region's convex corners, with their interior angles, measured over
 * edges at least `span` long (so a curve made of short segments doesn't
 * count as corners). The region is on the left of its contours.
 */
function convexCorners(
  region: CamPoint[][],
  span: number,
): Array<CamPoint & { angle: number }> {
  const corners: Array<CamPoint & { angle: number }> = [];
  for (const contour of region) {
    const n = contour.length;
    const away = (i: number, step: 1 | -1) => {
      for (let k = 1; k < n; k++) {
        const p = contour[(i + step * k + n * k) % n];
        if (Math.hypot(p.x - contour[i].x, p.y - contour[i].y) >= span) {
          return p;
        }
      }
      return contour[(i + step + n) % n];
    };
    for (let i = 0; i < n; i++) {
      const v = contour[i];
      const prev = away(i, -1);
      const next = away(i, 1);
      const turn =
        (v.x - prev.x) * (next.y - v.y) - (v.y - prev.y) * (next.x - v.x);
      if (turn <= 0) {
        continue; // concave (or straight): the axis doesn't go there
      }
      const ax = prev.x - v.x;
      const ay = prev.y - v.y;
      const bx = next.x - v.x;
      const by = next.y - v.y;
      const cos =
        (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      corners.push({ ...v, angle: Math.acos(Math.max(-1, Math.min(1, cos))) });
    }
  }
  return corners;
}

/**
 * A depth-first walk over every edge reachable from `start` (without
 * recursion: skeletons can be deep), stepping back along walked edges to go
 * on from earlier nodes. The steps back at the very end are left off.
 */
function depthFirstWalk(
  start: number,
  adjacency: Map<number, number[]>,
  walked: Set<string>,
  visited: Set<number>,
): number[] {
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const steps: Array<{ node: number; back: boolean }> = [
    { node: start, back: false },
  ];
  const stack: Array<{ node: number; next: number }> = [
    { node: start, next: 0 },
  ];
  visited.add(start);
  while (stack.length) {
    const top = stack[stack.length - 1];
    const neighbours = adjacency.get(top.node)!;
    if (top.next < neighbours.length) {
      const next = neighbours[top.next++];
      const k = key(top.node, next);
      if (walked.has(k)) {
        continue;
      }
      walked.add(k);
      visited.add(next);
      steps.push({ node: next, back: false });
      stack.push({ node: next, next: 0 });
    } else {
      stack.pop();
      if (stack.length) {
        steps.push({ node: stack[stack.length - 1].node, back: true });
      }
    }
  }
  while (steps.length > 1 && steps[steps.length - 1].back) {
    steps.pop();
  }
  return steps.map((s) => s.node);
}

/** Points along the walk no further than `spacing` apart, with distances. */
function measure(
  points: CamPoint[],
  spacing: number,
  distance: EdgeDistance,
): AxisPoint[] {
  const out: AxisPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    if (i > 0) {
      const p = points[i - 1];
      const n = Math.ceil(Math.hypot(a.x - p.x, a.y - p.y) / spacing);
      for (let k = 1; k < n; k++) {
        const q = {
          x: p.x + ((a.x - p.x) * k) / n,
          y: p.y + ((a.y - p.y) * k) / n,
        };
        out.push({ ...q, d: distance.to(q) });
      }
    }
    out.push({ ...a, d: distance.to(a) });
  }
  return out;
}

type Sample = CamPoint & { contour: number; index: number; count: number };

function sampleContours(region: CamPoint[][], spacing: number): Sample[] {
  const samples: Sample[] = [];
  region.forEach((contour, c) => {
    const points: CamPoint[] = [];
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const n = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing),
      );
      for (let k = 0; k < n; k++) {
        points.push({
          x: a.x + ((b.x - a.x) * k) / n,
          y: a.y + ((b.y - a.y) * k) / n,
        });
      }
    }
    points.forEach((p, index) =>
      samples.push({ ...p, contour: c, index, count: points.length }),
    );
  });
  return samples;
}

function circumcenter(a: CamPoint, b: CamPoint, c: CamPoint): CamPoint | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ex = c.x - a.x;
  const ey = c.y - a.y;
  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const d = 0.5 / det;
  return { x: a.x + (ey * bl - dy * cl) * d, y: a.y + (dx * cl - ex * bl) * d };
}

type Edge = { a: CamPoint; b: CamPoint };

/** Even-odd point-in-region test, with the edges bucketed in horizontal strips. */
class RegionTester {
  private strips: Edge[][] = [];
  private minY = Infinity;
  private height = 1;

  constructor(region: CamPoint[][]) {
    const edges = region.flatMap((c) =>
      c.map((a, i) => ({ a, b: c[(i + 1) % c.length] })),
    );
    const ys = region.flat().map((p) => p.y);
    this.minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const count = Math.max(1, Math.min(4096, Math.ceil(edges.length / 4)));
    this.height = Math.max((maxY - this.minY) / count, 1e-9);
    this.strips = Array.from({ length: count + 1 }, () => []);
    for (const e of edges) {
      const lo = this.strip(Math.min(e.a.y, e.b.y));
      const hi = this.strip(Math.max(e.a.y, e.b.y));
      for (let s = lo; s <= hi; s++) {
        this.strips[s].push(e);
      }
    }
  }

  private strip(y: number) {
    return Math.max(
      0,
      Math.min(
        this.strips.length - 1,
        Math.floor((y - this.minY) / this.height),
      ),
    );
  }

  contains(p: CamPoint): boolean {
    let inside = false;
    for (const { a, b } of this.strips[this.strip(p.y)] ?? []) {
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
}

/** Exact distance to the region's edges, with the edges in a uniform grid. */
class EdgeDistance {
  private cells = new Map<string, Edge[]>();
  private size: number;

  constructor(region: CamPoint[][]) {
    const edges = region.flatMap((c) =>
      c.map((a, i) => ({ a, b: c[(i + 1) % c.length] })),
    );
    const xs = region.flat().map((p) => p.x);
    const ys = region.flat().map((p) => p.y);
    const extent = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      1e-6,
    );
    this.size = Math.max(extent / 64, 0.5);
    for (const e of edges) {
      const x0 = Math.floor(Math.min(e.a.x, e.b.x) / this.size);
      const x1 = Math.floor(Math.max(e.a.x, e.b.x) / this.size);
      const y0 = Math.floor(Math.min(e.a.y, e.b.y) / this.size);
      const y1 = Math.floor(Math.max(e.a.y, e.b.y) / this.size);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k)!.push(e);
        }
      }
    }
  }

  to(p: CamPoint): number {
    const cx = Math.floor(p.x / this.size);
    const cy = Math.floor(p.y / this.size);
    let best = Infinity;
    // Search rings of cells outwards until nothing nearer can be left.
    for (let ring = 0; ring < 1e4; ring++) {
      if (best <= (ring - 1) * this.size) {
        break;
      }
      for (let x = cx - ring; x <= cx + ring; x++) {
        for (let y = cy - ring; y <= cy + ring; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) {
            continue;
          }
          for (const { a, b } of this.cells.get(`${x},${y}`) ?? []) {
            best = Math.min(best, segmentDistance(p, a, b));
          }
        }
      }
      if (ring > 0 && !this.cells.size) {
        break;
      }
    }
    return best;
  }
}

function segmentDistance(p: CamPoint, a: CamPoint, b: CamPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0
      ? Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
        )
      : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
