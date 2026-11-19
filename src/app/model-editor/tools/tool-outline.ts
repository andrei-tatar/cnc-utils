import { taperedBallNose, toolProfile } from '../../../cam/simulate';
import type { ToolType } from './index';

/** A point of a bit's outline: mm from its axis, mm above its tip. */
export type OutlinePoint = [number, number];

/** A bit as drawn: its settings, expressions worked out. */
export type DrawnTool = Partial<
  Pick<
    ToolType,
    | 'bitType'
    | 'diameter'
    | 'vAngle'
    | 'tipDiameter'
    | 'cornerRadius'
    | 'pointAngle'
    | 'tipRadius'
    | 'taperAngle'
    | 'neckDiameter'
    | 'headHeight'
    | 'fluteLength'
    | 'stickout'
    | 'flutes'
    | 'fluteType'
    | 'upcutLength'
  >
>;

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** How high above the tip the bit reaches its full diameter. */
export function tipHeight(tool: DrawnTool): number {
  const diameter = positive(tool.diameter);
  if (tool.bitType === 'keyhole') {
    return 0;
  }
  return toolProfile({
    ...tool,
    bitType: tool.bitType ?? 'end-mill',
    diameter,
  })(diameter / 2);
}

/**
 * The right half of the bit's outline, from the middle of its tip up its
 * side to `top` (mm above the tip, or where it reaches its full diameter
 * when that's higher): the shape the simulation cuts with (`toolProfile`);
 * a keyhole bit's head with its neck above.
 */
export function toolOutline(tool: DrawnTool, top: number): OutlinePoint[] {
  const diameter = positive(tool.diameter);
  const r = diameter / 2;
  if (tool.bitType === 'keyhole') {
    const head = positive(tool.headHeight);
    const neck = Math.min(positive(tool.neckDiameter) / 2, r);
    return [
      [0, 0],
      [r, 0],
      [r, head],
      [neck, head],
      [neck, Math.max(top, head)],
    ];
  }
  const simulated = {
    ...tool,
    bitType: tool.bitType ?? 'end-mill',
    diameter,
  };
  const profile = toolProfile(simulated);
  // Evenly across the bit, and where its shape changes.
  const STEPS = 96;
  const at = new Set<number>();
  for (let i = 0; i <= STEPS; i++) {
    at.add((r * i) / STEPS);
  }
  for (const corner of corners(tool, r)) {
    if (corner > 0 && corner < r) at.add(corner);
  }
  const points: OutlinePoint[] = [...at]
    .sort((a, b) => a - b)
    .map((d) => [d, profile(d)]);
  const last = points[points.length - 1][1];
  if (top > last) {
    points.push([r, top]);
  }
  return points;
}

/**
 * How far from the axis the outline is, `z` above the tip (the widest
 * where it's level there).
 */
export function halfWidthAt(outline: OutlinePoint[], z: number): number {
  let width = 0;
  for (let i = 1; i < outline.length; i++) {
    const [d0, z0] = outline[i - 1];
    const [d1, z1] = outline[i];
    if (z < Math.min(z0, z1) || z > Math.max(z0, z1)) continue;
    const at =
      z1 === z0 ? Math.max(d0, d1) : d0 + ((z - z0) / (z1 - z0)) * (d1 - d0);
    width = Math.max(width, at);
  }
  return width;
}

/** Where, from the axis, the bit's outline has a corner. */
function corners(tool: DrawnTool, r: number): number[] {
  switch (tool.bitType) {
    case 'v-bit':
      return [positive(tool.tipDiameter) / 2];
    case 'bull-nose':
      return [r - Math.min(positive(tool.cornerRadius), r)];
    case 'tapered-ball-nose':
      return [taperedBallNose({ ...tool, diameter: 2 * r }).reach];
    default:
      return [];
  }
}
