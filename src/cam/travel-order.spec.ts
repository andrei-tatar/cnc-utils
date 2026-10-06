import { CamPoint } from './types';
import {
  insideFirst,
  orderPoints,
  travelLength,
  travelOrder,
  TravelStop,
} from './travel-order';

const origin = { x: 0, y: 0 };

function square(cx: number, cy: number, half: number): CamPoint[] {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

describe('travel order', () => {
  it('visits points nearest first', () => {
    const points = [
      { x: 30, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(orderPoints(points, origin)).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('beats nearest first where it doubles back', () => {
    // Nearest first goes right along the row, then has to come all the way
    // back for the far left point.
    const points = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: -1.5, y: 0 },
    ];
    const stops = points.map((p) => ({ starts: [p] }));
    const legs = travelOrder(stops, origin);
    // Left first (1.5 + 2.5 + 3 = 7), not right first (4 + 5.5 = 9.5).
    expect(travelLength(stops, legs, origin)).toBeCloseTo(7);
  });

  it('starts loops at their nearest point', () => {
    const near = square(10, 0, 1);
    const [leg] = travelOrder([{ starts: near }], origin);
    expect(near[leg.start]).toEqual({ x: 9, y: -1 });
  });

  it('cuts what lies inside a loop before the loop', () => {
    const outer = square(50, 0, 10);
    const hole = square(50, 0, 2);
    const paths = [
      { points: outer, close: true },
      { points: hole, close: true },
    ];
    const after = insideFirst(paths);
    expect(after).toEqual([[1], []]);

    const stops: TravelStop[] = paths.map((p, i) => ({
      starts: p.points,
      after: after[i],
    }));
    // The outline is nearer, but the hole goes first.
    expect(travelOrder(stops, origin).map((l) => l.index)).toEqual([1, 0]);
  });

  it('keeps the order when improving it', () => {
    // A row of parts, each with a hole: every hole must stay before its
    // part.
    const paths = [0, 1, 2, 3, 4].flatMap((k) => [
      { points: square(k * 30, 0, 10), close: true },
      { points: square(k * 30, 0, 2), close: true },
    ]);
    const after = insideFirst(paths);
    const stops = paths.map((p, i) => ({ starts: p.points, after: after[i] }));
    const order = travelOrder(stops, { x: 200, y: 0 }).map((l) => l.index);
    expect([...order].sort((a, b) => a - b)).toEqual([...paths.keys()]);
    for (let part = 0; part < paths.length; part += 2) {
      expect(order.indexOf(part + 1)).toBeLessThan(order.indexOf(part));
    }
  });

  it('turns open paths round when that is shorter', () => {
    const path = [
      { x: 20, y: 0 },
      { x: 10, y: 0 },
    ];
    const [leg] = travelOrder(
      [{ starts: path, end: (s) => path[1 - s] }],
      origin,
    );
    expect(leg.start).toBe(1);
  });
});
