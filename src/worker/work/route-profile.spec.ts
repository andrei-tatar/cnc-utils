import { CamPoint, CamShape } from '../../cam/types';
import { fromPoints, signedArea } from '../../cam/arcs';
import { routeProfile } from './route-profile';

// A 40 × 40 part with a 10 × 10 hole in the middle.
const square = (min: number, max: number): CamPoint[] => [
  { x: min, y: min },
  { x: max, y: min },
  { x: max, y: max },
  { x: min, y: max },
];
const part: CamShape[] = [
  {
    sourceShapeId: 's',
    polygons: [
      { vertices: square(0, 40), close: true },
      { vertices: square(15, 25).reverse(), close: true },
    ],
  },
];

const options = {
  toolSize: 4,
  side: 'outside' as const,
  direction: 'climb' as const,
  startDepth: 0,
  depthPerStep: 1,
  steps: 1,
  optimizeTravel: false,
};

const carves = async (extra: object = {}) =>
  (await routeProfile(part, { ...options, ...extra }))
    .toPaths()
    .filter((p) => p.type === 'carve');

/** Whether the bit's centre at `p` is in the part (where it mustn't go). */
const inPart = (p: CamPoint) =>
  p.x > 0.5 &&
  p.x < 39.5 &&
  p.y > 0.5 &&
  p.y < 39.5 &&
  !(p.x > 16.5 && p.x < 23.5 && p.y > 16.5 && p.y < 23.5);

describe('routeProfile', () => {
  it('climbs round the outline clockwise and inside the hole counter-clockwise', async () => {
    const paths = await carves();
    const areas = paths.map((p) => signedArea(fromPoints(p.points, true)));
    const [outline, hole] = [...areas].sort(
      (a, b) => Math.abs(b) - Math.abs(a),
    );
    expect(outline).toBeLessThan(0);
    expect(hole).toBeGreaterThan(0);
  });

  for (const direction of ['climb', 'conventional'] as const) {
    it(`leads in and out on the waste side of holes too (${direction})`, async () => {
      const paths = await carves({ leadIn: 2, direction });
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(path.points.filter(inPart)).toEqual([]);
      }
    });
  }
});
