import { CamPoint } from './types';

/**
 * What an edge of a box panel does where it meets another panel:
 * - `flat`: a plain edge
 * - `tabs`: fingers, with a finger at each end
 * - `slots`: fingers, with a slot at each end (mates with `tabs`)
 * - `tenons`: a few tenons standing out by the thickness, to go through
 *   mortises in the other panel (`mortiseRects`)
 * - `tails`: dovetails standing out, widening to their ends: joins a panel
 *   lying beside it, edge to edge, whose edge has `sockets`
 * - `sockets`: the dovetails' sockets (mates with `tails`)
 */
export type EdgeJoint =
  'flat' | 'tabs' | 'slots' | 'tenons' | 'tails' | 'sockets';

/** Where an edge's tenons go (and the mortises they fit). */
export type TenonLayout = {
  /** How many along the edge. */
  count: number;
  /** How wide each is (mm). */
  width: number;
  /** From each end of the edge to the nearest one (mm). */
  margin: number;
};

export type BoxPanel = {
  /** Outer size of the panel, fingers included (mm). */
  width: number;
  height: number;
  /** Material thickness: how deep the slots are (mm). */
  thickness: number;
  /** Rough finger width; each edge gets an odd number of equal fingers. */
  fingerWidth: number;
  /** How much narrower a finger is than its slot (mm). */
  play: number;
  /** Bottom, right, top, left. */
  edges: [EdgeJoint, EdgeJoint, EdgeJoint, EdgeJoint];
  /** For `tenons` edges. */
  tenons?: TenonLayout;
  /**
   * For `tails` and `sockets` edges: how many dovetails, and how far their
   * sides lean from square (degrees).
   */
  dovetails?: { count: number; angle: number };
};

/**
 * Where tenons go along an edge `length` long: `count` of them `width`
 * wide, the first and last `margin` in from the ends, the rest evenly
 * between (one: in the middle). As spans from the edge's start.
 */
export function tenonSpans(
  length: number,
  layout: TenonLayout,
): Array<{ from: number; to: number }> {
  const count = Math.max(1, Math.round(layout.count));
  const width = Math.max(0, Math.min(layout.width, length / count));
  const room = Math.max(0, length - width);
  const margin = Math.max(0, Math.min(layout.margin, room / 2));
  return Array.from({ length: count }, (_, k) => {
    const from =
      count === 1 ? room / 2 : margin + ((room - 2 * margin) * k) / (count - 1);
    return { from, to: from + width };
  });
}

/**
 * The mortises for an edge's tenons (see `tenonSpans`): through slots in
 * the other panel, along X from 0 to `length` and centred on it in Y,
 * each the tenon's width by the material's thickness, `play` bigger both
 * ways.
 */
export function mortiseRects(
  length: number,
  layout: TenonLayout,
  thickness: number,
  play: number,
): CamPoint[][] {
  const grow = Math.max(0, play) / 2;
  const half = Math.max(0, thickness) / 2 + grow;
  return tenonSpans(length, layout).map(({ from, to }) => [
    { x: from - grow, y: -half },
    { x: to + grow, y: -half },
    { x: to + grow, y: half },
    { x: from - grow, y: half },
  ]);
}

/** The number of fingers and slots along an edge: odd, so both ends match. */
export function fingerCount(length: number, fingerWidth: number): number {
  if (!(fingerWidth > 0) || !(length > 0)) return 1;
  let n = Math.max(1, Math.round(length / fingerWidth));
  if (n % 2 === 0) {
    n += length / fingerWidth > n ? 1 : -1;
  }
  return Math.max(1, n);
}

/**
 * The panel's outline, counter-clockwise from the bottom-left corner. Two
 * panels whose edges have the same length and finger width, one `tabs` and
 * one `slots`, fit together.
 */
export function boxPanelOutline(panel: BoxPanel): CamPoint[] {
  const { width: w, height: h } = panel;
  const t = Math.max(0, Math.min(panel.thickness, w / 2, h / 2));
  // Each edge runs counter-clockwise; `inward` points into the panel.
  const edges = [
    {
      start: { x: 0, y: 0 },
      along: { x: 1, y: 0 },
      inward: { x: 0, y: 1 },
      length: w,
    },
    {
      start: { x: w, y: 0 },
      along: { x: 0, y: 1 },
      inward: { x: -1, y: 0 },
      length: h,
    },
    {
      start: { x: w, y: h },
      along: { x: -1, y: 0 },
      inward: { x: 0, y: -1 },
      length: w,
    },
    {
      start: { x: 0, y: h },
      along: { x: 0, y: -1 },
      inward: { x: 1, y: 0 },
      length: h,
    },
  ];
  const profiles = edges.map((edge, i) =>
    edgeProfile(edge.length, panel.edges[i], panel, t),
  );

  const points: CamPoint[] = [];
  const at = (i: number, u: number, v: number) => {
    const e = edges[i];
    points.push({
      x: e.start.x + e.along.x * u + e.inward.x * v,
      y: e.start.y + e.along.y * u + e.inward.y * v,
    });
  };

  for (let i = 0; i < 4; i++) {
    const profile = profiles[i];
    // The corner is inset by however deep each edge is there.
    const startU = profiles[(i + 3) % 4].endDepth;
    const endU = edges[i].length - profiles[(i + 1) % 4].startDepth;
    at(i, startU, profile.startDepth);
    for (const p of profile.points) {
      if (p.u <= startU || p.u >= endU) continue;
      at(i, p.u, p.v);
    }
  }
  return points;
}

type Profile = {
  startDepth: number;
  endDepth: number;
  /**
   * The edge between its ends: points along it (`u`) and in from the
   * panel's outer size (`v`: 0, full, to the thickness, recessed).
   */
  points: { u: number; v: number }[];
};

function edgeProfile(
  length: number,
  joint: EdgeJoint,
  panel: BoxPanel,
  thickness: number,
): Profile {
  if (joint === 'flat' || thickness <= 0) {
    return { startDepth: 0, endDepth: 0, points: [] };
  }
  if (joint === 'tenons') {
    return tenonProfile(length, panel, thickness);
  }
  if (joint === 'tails' || joint === 'sockets') {
    return dovetailProfile(length, joint, panel, thickness);
  }
  return fingerProfile(length, joint, panel.fingerWidth, thickness, panel.play);
}

/** Fingers and slots, alternating (an odd number of them). */
function fingerProfile(
  length: number,
  joint: 'tabs' | 'slots',
  fingerWidth: number,
  thickness: number,
  play: number,
): Profile {
  const n = fingerCount(length, fingerWidth);
  const width = length / n;
  const depthOf = (k: number) =>
    (k % 2 === 0) === (joint === 'tabs') ? 0 : thickness;
  // Slots are widened by half the play on each panel, fingers narrowed.
  const widen = Math.max(0, Math.min(play / 4, width / 4));
  const points = [];
  for (let k = 1; k < n; k++) {
    const from = depthOf(k - 1);
    const to = depthOf(k);
    const into = to > from;
    const u = k * width + (into ? -widen : widen);
    points.push({ u, v: from }, { u, v: to });
  }
  return { startDepth: depthOf(0), endDepth: depthOf(n - 1), points };
}

/**
 * The edge recessed by the thickness, with tenons standing out to the
 * panel's outer size, as wide as they're laid out: their mortises take the
 * play (`mortiseRects`).
 */
function tenonProfile(
  length: number,
  panel: BoxPanel,
  thickness: number,
): Profile {
  const layout = panel.tenons ?? { count: 2, width: 20, margin: 20 };
  const points = tenonSpans(length, layout).flatMap(({ from, to }) =>
    to > from
      ? [
          { u: from, v: thickness },
          { u: from, v: 0 },
          { u: to, v: 0 },
          { u: to, v: thickness },
        ]
      : [],
  );
  return { startDepth: thickness, endDepth: thickness, points };
}

/**
 * Dovetails in the panel's plane, `count` along the edge, one centred in
 * each equal pitch: `tails` stand out by the thickness, widest at their
 * ends; `sockets` are cut in by it, widest at their bottoms. Their sides
 * lean `angle` from square. Facing each other, a `tails` edge and a
 * `sockets` edge of the same length and count fit, `play` apart (tails
 * narrowed by a quarter of it each side, sockets widened as much).
 */
function dovetailProfile(
  length: number,
  joint: 'tails' | 'sockets',
  panel: BoxPanel,
  depth: number,
): Profile {
  const count = Math.max(1, Math.round(panel.dovetails?.count ?? 3));
  const pitch = length / count;
  // The sides never lean so far that tails meet.
  const lean = Math.min(
    Math.tan(((panel.dovetails?.angle ?? 10) * Math.PI) / 180),
    pitch / 2 / Math.max(depth, 1e-9) - 1e-6,
  );
  const ease = Math.max(0, Math.min(panel.play / 4, pitch / 8));
  const tails = joint === 'tails';
  // A tail's half-width at depth `v` in from the tails edge (its end at 0):
  // a quarter pitch halfway down.
  const halfTail = (v: number) =>
    pitch / 4 + Math.max(0, lean) * (depth / 2 - v);
  const points: Array<{ u: number; v: number }> = [];
  for (let k = 0; k < count; k++) {
    const middle = (k + 0.5) * pitch;
    if (tails) {
      // From the edge's body, out to the tail's end and back.
      const root = halfTail(depth) - ease;
      const end = halfTail(0) - ease;
      points.push(
        { u: middle - root, v: depth },
        { u: middle - end, v: 0 },
        { u: middle + end, v: 0 },
        { u: middle + root, v: depth },
      );
    } else {
      // In from the edge to the socket's bottom: the tail turned round, its
      // end at the bottom.
      const mouth = halfTail(depth) + ease;
      const bottom = halfTail(0) + ease;
      points.push(
        { u: middle - mouth, v: 0 },
        { u: middle - bottom, v: depth },
        { u: middle + bottom, v: depth },
        { u: middle + mouth, v: 0 },
      );
    }
  }
  const ends = tails ? depth : 0;
  return { startDepth: ends, endDepth: ends, points };
}
