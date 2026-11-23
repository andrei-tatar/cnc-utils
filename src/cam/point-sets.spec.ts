import { combinePoints, PointSet, singlePoints } from './point-sets';
import { CamPolygon } from './types';

const square = (x: number, y: number, size: number): CamPolygon => ({
  vertices: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
  close: true,
});

const points = (...xy: [number, number][]): PointSet => ({
  region: [],
  points: xy.map(([x, y]) => ({ x, y })),
});

describe('combining shapes with points', () => {
  it('reads single points, each once', () => {
    expect(
      singlePoints([
        { vertices: [{ x: 1, y: 2 }], close: false },
        square(0, 0, 5),
        { vertices: [{ x: 1, y: 2 }], close: false },
        { vertices: [{ x: 3, y: 4 }], close: false },
      ]),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('unites point patterns, a shared point once', () => {
    const a = points([0, 0], [10, 0]);
    const b = points([10, 0], [20, 0]);
    expect(combinePoints(a, b, 'union')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('subtracts the points in an area, or at the same place', () => {
    const a = points([1, 1], [10, 10], [20, 20]);
    const b: PointSet = {
      region: [square(0, 0, 5)],
      points: [{ x: 20, y: 20 }],
    };
    expect(combinePoints(a, b, 'difference')).toEqual([{ x: 10, y: 10 }]);
  });

  it('intersects: the points of each in the other', () => {
    const a: PointSet = {
      region: [square(0, 0, 5)],
      points: [
        { x: 30, y: 30 },
        { x: 40, y: 40 },
      ],
    };
    const b = points([1, 1], [8, 8], [30, 30]);
    expect(combinePoints(a, b, 'intersection')).toEqual([
      { x: 30, y: 30 },
      { x: 1, y: 1 },
    ]);
  });

  it('xor keeps the points in only one', () => {
    const a = points([0, 0], [10, 0]);
    const b = points([10, 0], [20, 0]);
    expect(combinePoints(a, b, 'xor')).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });
});
