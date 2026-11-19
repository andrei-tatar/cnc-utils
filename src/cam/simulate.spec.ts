import { simulateStock, taperedBallNose, toolProfile } from './simulate';
import { CamPath } from './types';

describe('simulateStock', () => {
  const stock = { minX: 0, minY: 0, maxX: 20, maxY: 20, top: 0, bottom: -10 };
  const cut: CamPath = {
    sourceShapeId: 's',
    sourceOperationId: 'op',
    type: 'carve',
    points: [
      { x: 2, y: 10, z: -3 },
      { x: 18, y: 10, z: -3 },
    ],
  };
  const at = (map: ReturnType<typeof simulateStock>, x: number, y: number) =>
    map.heights[
      Math.floor((y - map.minY) / map.cell) * map.nx +
        Math.floor((x - map.minX) / map.cell)
    ];

  it('cuts a flat groove as wide as an end mill', () => {
    const map = simulateStock(
      [cut],
      { op: { bitType: 'end-mill', diameter: 6 } },
      stock,
      40_000,
    );
    expect(at(map, 10, 10)).toBeCloseTo(-3);
    expect(at(map, 10, 12.5)).toBeCloseTo(-3);
    expect(at(map, 10, 14)).toBe(0);
  });

  it('leaves a V from a V-bit and ignores travel', () => {
    const map = simulateStock(
      [
        cut,
        {
          ...cut,
          type: 'travel',
          points: cut.points.map((p) => ({ ...p, z: -9 })),
        },
      ],
      { op: { bitType: 'v-bit', diameter: 12, vAngle: 90 } },
      stock,
      40_000,
    );
    expect(at(map, 10, 10.05)).toBeCloseTo(-3, 0);
    expect(at(map, 10, 12.05)).toBeCloseTo(-1, 0);
  });

  it('stops at the bottom of the stock', () => {
    const deep = { ...cut, points: cut.points.map((p) => ({ ...p, z: -20 })) };
    const map = simulateStock(
      [deep],
      { op: { bitType: 'end-mill', diameter: 6 } },
      stock,
      40_000,
    );
    expect(at(map, 10, 10)).toBe(-10);
  });

  it('shapes a ball nose round', () => {
    const ball = toolProfile({ bitType: 'ball-nose', diameter: 6 });
    expect(ball(0)).toBe(0);
    expect(ball(3)).toBeCloseTo(3);
  });

  it('shapes a tapered ball nose: a ball, then a straight side', () => {
    const tool = {
      bitType: 'tapered-ball-nose',
      diameter: 6,
      tipRadius: 0.5,
      taperAngle: 5,
    };
    const profile = toolProfile(tool);
    const { reach, height, top } = taperedBallNose(tool);
    const angle = (5 * Math.PI) / 180;
    expect(profile(0)).toBe(0);
    // On the ball below where the side starts.
    expect(profile(0.3)).toBeCloseTo(0.5 - Math.sqrt(0.25 - 0.09));
    expect(reach).toBeCloseTo(0.5 * Math.cos(angle));
    expect(height).toBeCloseTo(0.5 * (1 - Math.sin(angle)));
    // The side leaves the ball smoothly, 5° off the axis.
    expect(profile(reach)).toBeCloseTo(height);
    const slope = (from: number, to: number) =>
      (profile(to) - profile(from)) / (to - from);
    expect(slope(reach, reach + 1e-3)).toBeCloseTo(1 / Math.tan(angle), 6);
    expect(slope(reach - 1e-5, reach)).toBeCloseTo(1 / Math.tan(angle), 0);
    expect(profile(3)).toBeCloseTo(top);
    expect(top).toBeCloseTo(height + (3 - reach) / Math.tan(angle));
  });

  it('takes a tapered ball nose with a ball as wide as it is for a ball nose', () => {
    const tapered = toolProfile({
      bitType: 'tapered-ball-nose',
      diameter: 6,
      tipRadius: 4,
      taperAngle: 0,
    });
    const ball = toolProfile({ bitType: 'ball-nose', diameter: 6 });
    for (const d of [0, 1, 2, 3]) {
      expect(tapered(d)).toBeCloseTo(ball(d));
    }
  });
});

describe('simulating a plunge', () => {
  it('cuts down to the bottom of a move straight down', () => {
    const map = simulateStock(
      [
        {
          type: 'carve',
          sourceShapeId: 's',
          sourceOperationId: 'o',
          points: [
            { x: 30, y: 30, z: 0 },
            { x: 30, y: 30, z: -10 },
          ],
        },
      ],
      { o: { bitType: 'end-mill', diameter: 6 } },
      { minX: 0, minY: 0, maxX: 60, maxY: 60, top: 0, bottom: -20 },
      10_000,
    );
    const at = (x: number, y: number) =>
      map.heights[
        Math.floor((y - map.minY) / map.cell) * map.nx +
          Math.floor((x - map.minX) / map.cell)
      ];
    expect(at(30, 30)).toBeCloseTo(-10, 6);
    expect(at(40, 30)).toBe(0);
  });
});
