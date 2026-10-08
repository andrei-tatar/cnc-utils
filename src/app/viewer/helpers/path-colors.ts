import { Color } from 'three';

/** Surface → deepest cut: pale cyan, blue, magenta. */
const DEPTH_STOPS = ['#b3f0ff', '#2f80ed', '#e040fb'];
/** Slowest → fastest feed: red, amber, green. */
const FEED_STOPS = ['#ef5350', '#ffca28', '#66bb6a'];
const DEPTH_COLORS = DEPTH_STOPS.map((hex) => new Color(hex));
const FEED_COLORS = FEED_STOPS.map((hex) => new Color(hex));

/** The same gradients for the HTML legend. */
export const DEPTH_GRADIENT_CSS = `linear-gradient(to right, ${DEPTH_STOPS.join(', ')})`;
export const FEED_GRADIENT_CSS = `linear-gradient(to right, ${FEED_STOPS.join(', ')})`;

/**
 * Colour for a cut at height `z` (≤ 0) when the job's deepest cut is at
 * `deepest` (≤ 0). Anything at or above the surface gets the surface colour.
 */
export function depthColor(z: number, deepest: number, target = new Color()) {
  const t = deepest < 0 ? z / deepest : 0;
  return gradient(DEPTH_COLORS, t, target);
}

/**
 * Colour for a cut at `feed` (mm/min) when the job's feeds run from `min` to
 * `max`. With only one feed in the job, every cut gets the fastest colour.
 */
export function feedColor(
  feed: number,
  min: number,
  max: number,
  target = new Color(),
) {
  const t = max > min ? (feed - min) / (max - min) : 1;
  return gradient(FEED_COLORS, t, target);
}

/** The colour `t` (clamped to 0 – 1) of the way along `stops`. */
function gradient(stops: Color[], t: number, target: Color) {
  const scaled = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return target.lerpColors(stops[i], stops[i + 1], scaled - i);
}

/** What the toolpaths' colours show. */
export type PathColoring = 'depth' | 'feed';

const STORAGE_KEY = 'ui.pathColoring';

/** The coloring last picked (depth when there's none, or it's unreadable). */
export function loadPathColoring(): PathColoring {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'feed' ? 'feed' : 'depth';
  } catch {
    return 'depth';
  }
}

export function savePathColoring(coloring: PathColoring) {
  try {
    localStorage.setItem(STORAGE_KEY, coloring);
  } catch {
    // Storage unavailable: it's only kept for this page load.
  }
}
