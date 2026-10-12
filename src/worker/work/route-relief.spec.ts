import { CamPoint, CamShape } from '../../cam/types';
import { simulateStock } from '../../cam/simulate';
import { binaryStl, PYRAMID } from '../../cam/stl.spec';
import {
  ReliefSourceOptions,
  routeRelief,
  routeReliefRough,
} from './route-relief';

const square = (min: number, max: number): CamPoint[] => [
  { x: min, y: min },
  { x: max, y: min },
  { x: max, y: max },
  { x: min, y: max },
];
const shape: CamShape[] = [
  { sourceShapeId: 's', polygons: [{ vertices: square(0, 20), close: true }] },
];

/** The pyramid as a data URL. */
function pyramidUrl(): string {
  const bytes = new Uint8Array(binaryStl(PYRAMID));
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

const relief = (): ReliefSourceOptions => ({
  file: pyramidUrl(),
  layout: {
    fit: 'stretch',
    scale: 100,
    alignX: 'center',
    alignY: 'middle',
    offsetX: 0,
    offsetY: 0,
  },
  invert: false,
  depth: 4,
  gamma: 1,
  smoothing: 0,
  around: 'floor',
  resolution: 0.1,
});

/** The pyramid carved 4 deep on the 20 × 20 square: its apex at the top. */
const target = (x: number, y: number) =>
  (-4 * Math.max(Math.abs(x - 10), Math.abs(y - 10))) / 10;

const ball = { bitType: 'ball-nose', diameter: 3 };

/** What's left of a block round the square once `paths` are cut. */
function left(builder: any, tool: { bitType: string; diameter: number }) {
  const paths = builder
    .toPaths()
    .map((p: any) => ({ ...p, sourceOperationId: 'o' }));
  return simulateStock(
    paths,
    { o: tool },
    { minX: -2, minY: -2, maxX: 22, maxY: 22, top: 0, bottom: -10 },
    250_000,
  );
}

describe('routeRelief', () => {
  it('carves the relief without cutting into it, close to it all over', async () => {
    const builder = await routeRelief(shape, {
      relief: relief(),
      tool: ball,
      spacing: 0.3,
      angle: 0,
      oneWay: false,
      crossPass: true,
    });
    const map = left(builder, ball);
    // A 0.3 mm stepover with a Ø3 ball leaves scallops under 0.01 mm; the
    // cells and the faces' edges take a little more.
    let worstAbove = 0;
    for (let j = 0; j < map.ny; j++) {
      for (let i = 0; i < map.nx; i++) {
        const x = map.minX + (i + 0.5) * map.cell;
        const y = map.minY + (j + 0.5) * map.cell;
        const z = map.heights[j * map.nx + i];
        if (x < 0 || x > 20 || y < 0 || y > 20) {
          // Outside the square: uncut.
          if (x < -0.1 || x > 20.1 || y < -0.1 || y > 20.1) {
            expect(z).toBeGreaterThan(-1e-6);
          }
          continue;
        }
        expect(z).toBeGreaterThan(target(x, y) - 0.05);
        // Away from the edges (the ball can't get into the floor's corner
        // against the wall) and the pyramid's ridges.
        const fromEdge = Math.min(x, y, 20 - x, 20 - y);
        const offRidge = Math.abs(Math.abs(x - 10) - Math.abs(y - 10));
        if (fromEdge > 2 && offRidge > 1.5) {
          worstAbove = Math.max(worstAbove, z - target(x, y));
        }
      }
    }
    expect(worstAbove).toBeLessThan(0.15);
  });
});

describe('routeReliefRough', () => {
  it('clears down to the stock left, never into it', async () => {
    const endMill = { bitType: 'end-mill', diameter: 4 };
    const builder = await routeReliefRough(shape, {
      relief: relief(),
      toolSize: 4,
      toolEngagement: 0.4,
      depthPerStep: 1,
      leaveStock: 0.5,
      optimizeTravel: true,
    });
    const map = left(builder, endMill);
    let deepest = 0;
    for (let j = 0; j < map.ny; j++) {
      for (let i = 0; i < map.nx; i++) {
        const x = map.minX + (i + 0.5) * map.cell;
        const y = map.minY + (j + 0.5) * map.cell;
        const z = map.heights[j * map.nx + i];
        const want = x < 0 || x > 20 || y < 0 || y > 20 ? 0 : target(x, y);
        // The stock to leave above the relief, where it's below the top.
        expect(z).toBeGreaterThan(Math.min(0, want + 0.5) - 0.1);
        deepest = Math.min(deepest, z);
      }
    }
    // Down to 2: below that, the bit's 4 mm doesn't fit in what's left to
    // clear (3.2 or more deep, 0.5 above the relief), 2 mm from the walls.
    expect(deepest).toBeCloseTo(-2, 3);
  });
});
