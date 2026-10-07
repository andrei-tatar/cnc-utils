import { simulateStock, toolProfile } from './simulate';
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
});
