import { CamPoint } from './types';

/**
 * What an edge of a box panel does where it meets another panel:
 * - `flat`: a plain edge
 * - `tabs`: fingers, with a finger at each end
 * - `slots`: fingers, with a slot at each end (mates with `tabs`)
 */
export type EdgeJoint = 'flat' | 'tabs' | 'slots';

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
};

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
    edgeProfile(edge.length, panel.edges[i], panel.fingerWidth, t, panel.play),
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
    for (const step of profile.steps) {
      if (step.at <= startU || step.at >= endU) continue;
      at(i, step.at, step.from);
      at(i, step.at, step.to);
    }
  }
  return points;
}

type Profile = {
  startDepth: number;
  endDepth: number;
  /** Where the edge steps between full (0) and recessed (thickness). */
  steps: { at: number; from: number; to: number }[];
};

function edgeProfile(
  length: number,
  joint: EdgeJoint,
  fingerWidth: number,
  thickness: number,
  play: number,
): Profile {
  if (joint === 'flat' || thickness <= 0) {
    return { startDepth: 0, endDepth: 0, steps: [] };
  }
  const n = fingerCount(length, fingerWidth);
  const width = length / n;
  const depthOf = (k: number) =>
    (k % 2 === 0) === (joint === 'tabs') ? 0 : thickness;
  // Slots are widened by half the play on each panel, fingers narrowed.
  const widen = Math.max(0, Math.min(play / 4, width / 4));
  const steps = [];
  for (let k = 1; k < n; k++) {
    const from = depthOf(k - 1);
    const to = depthOf(k);
    const into = to > from;
    steps.push({ at: k * width + (into ? -widen : widen), from, to });
  }
  return { startDepth: depthOf(0), endDepth: depthOf(n - 1), steps };
}
