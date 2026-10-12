import { blankHeightmap, sweep, toolProfile } from '../../cam/simulate';
import { CamPoint, CamShape } from '../../cam/types';
import { routePocketHole } from './route-pocket-hole';

const square = (x0: number, y0: number, x1: number, y1: number): CamPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
// A 60 × 40 pocket with a 10 × 10 island in it.
const pocket: CamShape[] = [
  {
    sourceShapeId: 's',
    polygons: [
      { vertices: square(0, 0, 60, 40), close: true },
      { vertices: square(35, 15, 45, 25).reverse(), close: true },
    ],
  },
];
const options = {
  toolSize: 6,
  leaveStock: 0,
  depthPerStep: 3,
  steps: 2,
  startDepth: 0,
  rampAngle: 3,
  optimizeTravel: true,
};

/**
 * Replays the cuts over the stock: the most of the bit's footprint in
 * material not cut yet (above where it cuts), anywhere it cuts across at a
 * level (helixes, plunges and steps down left out); and where it left
 * material it should have cut, or cut where it shouldn't.
 */
async function replay(strategy: 'offset' | 'adaptive', engagement: number) {
  const builder = await routePocketHole(pocket, {
    ...options,
    strategy,
    toolEngagement: engagement,
  });
  const map = blankHeightmap(
    { minX: -5, minY: -5, maxX: 65, maxY: 45, top: 0, bottom: -10 },
    160_000,
  );
  const tool = { bitType: 'end-mill', diameter: 6 };
  const profile = toolProfile(tool);
  const r = 3;
  let buried = 0;
  for (const path of builder.toPaths()) {
    if (path.type !== 'carve') continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const across =
        Math.abs(a.z - b.z) < 1e-6 && Math.hypot(b.x - a.x, b.y - a.y) > 0;
      if (across) {
        // The footprint where the bit arrives, before it cuts there.
        let inside = 0;
        let uncut = 0;
        const reach = Math.ceil(r / map.cell);
        const ci = Math.floor((b.x - map.minX) / map.cell);
        const cj = Math.floor((b.y - map.minY) / map.cell);
        for (let dj = -reach; dj <= reach; dj++) {
          for (let di = -reach; di <= reach; di++) {
            const x = map.minX + (ci + di + 0.5) * map.cell;
            const y = map.minY + (cj + dj + 0.5) * map.cell;
            if (Math.hypot(x - b.x, y - b.y) > r) continue;
            inside++;
            const h = map.heights[(cj + dj) * map.nx + ci + di];
            if (h > b.z + 0.5) uncut++;
          }
        }
        buried = Math.max(buried, uncut / inside);
      }
      sweep(map, a, b, r, profile);
    }
  }
  // What's left: in the pocket (in from its walls and the island's by a
  // cell), at the bottom; outside it, uncut.
  let missed = 0;
  let gouged = 0;
  for (let j = 0; j < map.ny; j++) {
    for (let i = 0; i < map.nx; i++) {
      const x = map.minX + (i + 0.5) * map.cell;
      const y = map.minY + (j + 0.5) * map.cell;
      const h = map.heights[j * map.nx + i];
      const inPocket =
        x > 0.5 &&
        x < 59.5 &&
        y > 0.5 &&
        y < 39.5 &&
        !(x > 34.5 && x < 45.5 && y > 14.5 && y < 25.5);
      const outside =
        x < -0.2 ||
        x > 60.2 ||
        y < -0.2 ||
        y > 40.2 ||
        (x > 35.2 && x < 44.8 && y > 15.2 && y < 24.8);
      // Not the pocket's inside corners: a round bit leaves them round.
      const corner = (x < 3 || x > 57) && (y < 3 || y > 37);
      if (inPocket && !corner && h > -6 + 0.05) missed++;
      if (outside && h < -0.05) gouged++;
    }
  }
  return { buried, missed, gouged };
}

describe('adaptive clearing', () => {
  it('clears the pocket round its island, never in further than the stepover allows', async () => {
    const adaptive = await replay('adaptive', 0.15);
    const offset = await replay('offset', 0.4);
    expect(adaptive.missed).toBe(0);
    expect(adaptive.gouged).toBe(0);
    // The offset rings start with a slot; adaptive takes about its stepover.
    expect(offset.buried).toBeGreaterThan(0.9);
    expect(adaptive.buried).toBeLessThan(0.25);
  });
});
