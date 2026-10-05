import { Color } from 'three';

/** Surface → deepest cut: pale cyan, blue, magenta. */
const STOPS = ['#b3f0ff', '#2f80ed', '#e040fb'];
const STOP_COLORS = STOPS.map((hex) => new Color(hex));

/** The same gradient for the HTML legend. */
export const DEPTH_GRADIENT_CSS = `linear-gradient(to right, ${STOPS.join(', ')})`;

/**
 * Colour for a cut at height `z` (≤ 0) when the job's deepest cut is at
 * `deepest` (≤ 0). Anything at or above the surface gets the surface colour.
 */
export function depthColor(z: number, deepest: number, target = new Color()) {
  const t = deepest < 0 ? Math.min(1, Math.max(0, z / deepest)) : 0;
  const scaled = t * (STOP_COLORS.length - 1);
  const i = Math.min(STOP_COLORS.length - 2, Math.floor(scaled));
  return target.lerpColors(STOP_COLORS[i], STOP_COLORS[i + 1], scaled - i);
}
