import { GCodeBuilder, PathInstruction } from './gcode-builder';
import {
  containingContours,
  pointInPolygon,
  signedArea2,
} from './polygon-nesting';
import { CamPoint, CamShape, CamTab } from './types';

const EPS = 1e-6;
/** How closely the edges of a tab are found along a cut (mm). */
const PRECISION = 1e-5;

/** Where a shape's tabs go (the `tabs` transform). */
export type TabPlacement = {
  /** The loops that get tabs: outlines, holes or both. */
  on: 'contours' | 'holes' | 'both';
  /**
   * Which way the tabs reach from the line: away from the shape's area
   * (out of an outline, into a hole), into it, or both ways.
   */
  side: 'outside' | 'inside' | 'both';
  /** Tabs on each loop, evenly spaced round it (without `at`). */
  count: number;
  /** Along the line (mm): how wide a bridge is left. */
  width: number;
  /** Across the line (mm), each way the tab reaches. */
  length: number;
  /** How deep the tabs' top is (mm below the surface). */
  depth: number;
  /** Moves the tabs this far round each loop (mm), from its first point. */
  offset: number;
  /**
   * Instead of spacing them evenly: one tab at each of these points, or
   * rather on the line nearest it (of the loops `on` says).
   */
  at?: CamPoint[];
};

/** A closed loop of a shape, as tabs are put on it. */
type Loop = {
  /** Which of the input's shapes it's in. */
  shape: number;
  edges: { a: CamPoint; b: CamPoint; length: number }[];
  perimeter: number;
  /** 1 when away from the shape's area is left of the way round, else -1. */
  away: number;
};

/**
 * `input` with tabs added on its closed loops (see TabPlacement). Each tab
 * is a rectangle across the line, square to it where its middle is; the
 * tabs are placed from each loop's first point (or at given points), so
 * they follow the shape through whatever moves or copies it afterwards.
 */
export function placeTabs(
  input: CamShape[],
  placement: TabPlacement,
): CamShape[] {
  const count = Math.floor(placement.count);
  const at = placement.at;
  if (
    (at ? !at.length : !(count >= 1)) ||
    !(placement.width > 0) ||
    !(placement.length > 0)
  ) {
    return input;
  }
  const closed = input.flatMap((shape, s) =>
    shape.polygons
      .filter((p) => p.close && p.points.length > 2)
      .map((p) => ({ s, points: p.points })),
  );
  const holes = containingContours(closed.map((l) => l.points)).map(
    (around) => around.length % 2 === 1,
  );
  const loops: Loop[] = closed.flatMap(({ s, points }, i) => {
    const hole = holes[i];
    if (
      (placement.on === 'contours' && hole) ||
      (placement.on === 'holes' && !hole)
    ) {
      return [];
    }
    const edges = points.map((a, k) => {
      const b = points[(k + 1) % points.length];
      return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    const perimeter = edges.reduce((sum, e) => sum + e.length, 0);
    if (!(perimeter > EPS)) {
      return [];
    }
    // Left of the way round is inside a counter-clockwise loop; away from
    // the shape's area is out of an outline, but into a hole.
    const into = signedArea2(points) > 0 ? 1 : -1;
    return [{ shape: s, edges, perimeter, away: hole ? into : -into }];
  });

  const added: CamTab[][] = input.map(() => []);
  if (at) {
    for (const point of at) {
      const nearest = nearestOnLoops(loops, point);
      if (nearest) {
        const { loop, edge, t } = nearest;
        added[loop.shape].push(
          tabOn(loop, edge, t, placement.width / 2, placement),
        );
      }
    }
  } else {
    for (const loop of loops) {
      added[loop.shape].push(...evenTabs(loop, { ...placement, count }));
    }
  }
  return input.map((shape, s) =>
    added[s].length
      ? { ...shape, tabs: [...(shape.tabs ?? []), ...added[s]] }
      : shape,
  );
}

/** `count` tabs spaced evenly round the loop, from its first point. */
function evenTabs(loop: Loop, placement: TabPlacement): CamTab[] {
  const { edges, perimeter } = loop;
  const { count, width, offset } = placement;
  const spacing = perimeter / count;
  const half = Math.min(width, spacing) / 2;
  const tabs: CamTab[] = [];
  for (let k = 0; k < count; k++) {
    // The edge the tab's middle is on, and how far along it.
    let along = mod((k + 0.5) * spacing + offset, perimeter);
    let e = 0;
    while (
      e < edges.length - 1 &&
      (along > edges[e].length || edges[e].length <= EPS)
    ) {
      along -= edges[e].length;
      e++;
    }
    while (e > 0 && edges[e].length <= EPS) e--; // (a last edge of no length)
    if (!(edges[e].length > 0)) continue;
    const t = Math.max(0, Math.min(1, along / edges[e].length));
    tabs.push(tabOn(loop, edges[e], t, half, placement));
  }
  return tabs;
}

/** The point of the loops' lines nearest `point`: the edge, how far along. */
function nearestOnLoops(loops: Loop[], point: CamPoint) {
  let best: { loop: Loop; edge: Loop['edges'][number]; t: number } | null =
    null;
  let bestDistance = Infinity;
  for (const loop of loops) {
    for (const edge of loop.edges) {
      if (!(edge.length > EPS)) continue;
      const { a, b } = edge;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
            (edge.length * edge.length),
        ),
      );
      const d = Math.hypot(
        point.x - (a.x + (b.x - a.x) * t),
        point.y - (a.y + (b.y - a.y) * t),
      );
      if (d < bestDistance - EPS) {
        bestDistance = d;
        best = { loop, edge, t };
      }
    }
  }
  return best;
}

/** A tab `half` wide each way, at `t` along the loop's `edge`. */
function tabOn(
  loop: Loop,
  edge: Loop['edges'][number],
  t: number,
  half: number,
  { side, length, depth }: TabPlacement,
): CamTab {
  const [near, far] =
    side === 'outside'
      ? [0, length]
      : side === 'inside'
        ? [-length, 0]
        : [-length, length];
  const dx = (edge.b.x - edge.a.x) / edge.length;
  const dy = (edge.b.y - edge.a.y) / edge.length;
  const c = {
    x: edge.a.x + (edge.b.x - edge.a.x) * t,
    y: edge.a.y + (edge.b.y - edge.a.y) * t,
  };
  // Square to the line, away from the shape's area.
  const ox = -dy * loop.away;
  const oy = dx * loop.away;
  const at = (u: number, v: number) => ({
    x: c.x + dx * u + ox * v,
    y: c.y + dy * u + oy * v,
  });
  return {
    points: [at(-half, near), at(half, near), at(half, far), at(-half, far)],
    top: -depth,
  };
}

/** Every tab of `shapes`, each once. */
export function tabsOf(shapes: CamShape[]): CamTab[] {
  const seen = new Set<string>();
  return shapes
    .flatMap((s) => s.tabs ?? [])
    .filter((tab) => {
      const key = JSON.stringify(tab);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Those of `tabs` a tool of `radius` could reach working within `box`. */
export function tabsNear(
  tabs: CamTab[],
  box: { minX: number; minY: number; maxX: number; maxY: number } | null,
  radius: number,
): CamTab[] {
  if (!box) {
    return [];
  }
  return tabs.filter((tab) => {
    const b = boxOf(tab.points, radius);
    return (
      b.minX <= box.maxX &&
      b.maxX >= box.minX &&
      b.minY <= box.maxY &&
      b.maxY >= box.minY
    );
  });
}

/** A tab as the tool's centre has to keep out of it. */
type KeepOut = {
  points: CamPoint[];
  top: number;
  /** The tool's centre stays at least this far from the footprint. */
  clearance: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
};

/**
 * `builder`'s moves, kept out of `tabs` by a tool of `radius`: wherever the
 * tool would cut into a tab's footprint below its top, it goes over it at
 * the top instead (straight up at its edge, then back down after it).
 * Ramps going through a tab are cut short the same way; plunges, rapids
 * down and drilling stop at the top of a tab they are over.
 *
 * Every bit is taken as wide as its diameter all the way up, so a V-bit
 * stays further away than it needs to.
 */
export function keepTabs(
  builder: GCodeBuilder,
  tabs: CamTab[],
  radius: number,
): GCodeBuilder {
  if (!tabs.length) {
    return builder;
  }
  const keepOuts: KeepOut[] = tabs.map((tab) => ({
    points: tab.points,
    top: tab.top,
    clearance: Math.max(radius - EPS, EPS),
    box: boxOf(tab.points, radius),
  }));
  const ceiling = (p: CamPoint) =>
    keepOuts.reduce(
      (top, k) => (k.top > top && covers(k, p) ? k.top : top),
      -Infinity,
    );

  const out: PathInstruction[] = [];
  let at: CamPoint | null = null;
  // The Z the cut asks for, and the Z the tool is at (above a tab, it's
  // higher). Infinity: at safe height.
  let want = Infinity;
  let z = Infinity;
  const moveZ = (to: number) => {
    if (Math.abs(to - z) > EPS) {
      out.push({ type: 'plunge', depth: to });
      z = to;
    }
  };

  for (const i of builder.instructions) {
    switch (i.type) {
      case 'safety-height':
        out.push(i);
        want = z = Infinity;
        break;

      case 'travel':
        out.push(i);
        at = i.to;
        break;

      case 'plunge': {
        want = i.depth;
        const to = at ? Math.max(want, ceiling(at)) : want;
        out.push(to === want ? i : { type: 'plunge', depth: to });
        z = to;
        break;
      }

      case 'rapid-z': {
        want = i.z;
        const to = at ? Math.max(want, ceiling(at)) : want;
        out.push(to === want ? i : { type: 'rapid-z', z: to });
        z = to;
        break;
      }

      case 'drill-cycle': {
        const top = ceiling(i);
        if (top < i.depth) {
          out.push(i);
        } else if (top < i.retract) {
          out.push({ ...i, depth: top });
        }
        // (Nothing to drill when the tab comes up to where it starts.)
        at = { x: i.x, y: i.y };
        want = z = Infinity;
        break;
      }

      case 'carve': {
        const from = at;
        const zA = want;
        const zB = i.z ?? want;
        at = i.to;
        want = zB;
        if (!from || !Number.isFinite(zA) || !Number.isFinite(zB)) {
          // Nowhere known to start from, or not cutting.
          out.push(i);
          if (i.z !== undefined) z = i.z;
          break;
        }
        // (Tabs it stays above don't matter.)
        const lowest = Math.min(zA, zB);
        const spans = keepOuts.flatMap((k) => {
          if (k.top <= lowest + EPS) return [];
          const span = within(k, from, i.to);
          return span ? [{ ...span, top: k.top }] : [];
        });
        if (!spans.length && Math.abs(z - zA) <= EPS) {
          out.push(i);
          z = zB;
          break;
        }
        const depthAt = (t: number) => zA + (zB - zA) * t;
        const cuts = [
          0,
          ...spans.flatMap((s) => [s.from, s.to]).filter((t) => t > 0 && t < 1),
          1,
        ].sort((a, b) => a - b);
        for (let k = 1; k < cuts.length; k++) {
          const [ta, tb] = [cuts[k - 1], cuts[k]];
          if (tb - ta <= 0) continue;
          const mid = (ta + tb) / 2;
          const top = spans.reduce(
            (t, s) => (s.from <= mid && s.to >= mid && s.top > t ? s.top : t),
            -Infinity,
          );
          // A ramp through the tab's top: split where it gets there.
          const parts = [ta, tb];
          if (Number.isFinite(top) && zA !== zB) {
            const tc = (top - zA) / (zB - zA);
            if (tc > ta && tc < tb) parts.splice(1, 0, tc);
          }
          for (let p = 1; p < parts.length; p++) {
            const start = Math.max(depthAt(parts[p - 1]), top);
            const end = Math.max(depthAt(parts[p]), top);
            moveZ(start);
            const to = lerp(from, i.to, parts[p]);
            out.push(
              Math.abs(end - z) > EPS
                ? { type: 'carve', to, z: end }
                : { type: 'carve', to },
            );
            z = end;
          }
        }
        break;
      }

      default:
        out.push(i);
    }
  }
  return GCodeBuilder.of(out, builder.isAtSafetyHeight);
}

/** Whether the tool's centre at `p` would cut into the tab. */
function covers(k: KeepOut, p: CamPoint): boolean {
  return (
    p.x >= k.box.minX &&
    p.x <= k.box.maxX &&
    p.y >= k.box.minY &&
    p.y <= k.box.maxY &&
    distanceTo(p, k.points) < k.clearance
  );
}

/**
 * The part of the move from `a` to `b` (as fractions of it) where the
 * tool's centre would cut into the tab, or null. The distance to a convex
 * footprint along a straight line falls, then rises: find its lowest, then
 * where it crosses the clearance either side.
 */
function within(
  k: KeepOut,
  a: CamPoint,
  b: CamPoint,
): { from: number; to: number } | null {
  if (
    Math.max(a.x, b.x) < k.box.minX ||
    Math.min(a.x, b.x) > k.box.maxX ||
    Math.max(a.y, b.y) < k.box.minY ||
    Math.min(a.y, b.y) > k.box.maxY
  ) {
    return null;
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const f = (t: number) => distanceTo(lerp(a, b, t), k.points);
  if (length < PRECISION) {
    return f(0) < k.clearance ? { from: 0, to: 1 } : null;
  }
  let lo = 0;
  let hi = 1;
  for (let n = 0; (hi - lo) * length > PRECISION && n < 200; n++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2;
    else lo = m1;
  }
  const lowest = (lo + hi) / 2;
  if (f(lowest) >= k.clearance) {
    return null;
  }
  // Between an outside point and an inside one, where it crosses.
  const crossing = (outside: number, inside: number) => {
    for (let n = 0; Math.abs(inside - outside) * length > PRECISION; n++) {
      const mid = (outside + inside) / 2;
      if (f(mid) < k.clearance) inside = mid;
      else outside = mid;
      if (n > 200) break;
    }
    return inside;
  };
  return {
    from: f(0) < k.clearance ? 0 : crossing(0, lowest),
    to: f(1) < k.clearance ? 1 : crossing(1, lowest),
  };
}

/** How far `p` is from the polygon (0 inside it). */
function distanceTo(p: CamPoint, polygon: CamPoint[]): number {
  if (pointInPolygon(p, polygon)) {
    return 0;
  }
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, segmentDistance(p, polygon[j], polygon[i]));
  }
  return best;
}

function segmentDistance(p: CamPoint, a: CamPoint, b: CamPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t =
    l2 > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function lerp(a: CamPoint, b: CamPoint, t: number): CamPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function boxOf(points: CamPoint[], margin: number) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  };
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}
