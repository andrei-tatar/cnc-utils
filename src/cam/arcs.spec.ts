import {
  arcOf,
  bulgeAround,
  closestOnSegment,
  distanceToPolygons,
  fromPoints,
  isArea,
  paramOnSegment,
  pointAlong,
  polygonLength,
  polygonPoints,
  polygonsBounds,
  reversePolygon,
  segmentLength,
  signedArea,
  tangentAlong,
  tangentAt,
  transformPolygon,
  windingNumber,
} from './arcs';
import { CamPolygon } from './types';

/** A circle as two half-circle arcs, counter-clockwise. */
const circle = (cx: number, cy: number, r: number): CamPolygon => ({
  vertices: [
    { x: cx - r, y: cy, bulge: 1 },
    { x: cx + r, y: cy, bulge: 1 },
  ],
  close: true,
});

const square = fromPoints(
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  true,
);

/** A 10 × 4 slot: half circles at both ends. */
const slot: CamPolygon = {
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 0, bulge: 1 },
    { x: 10, y: 4 },
    { x: 0, y: 4, bulge: 1 },
  ],
  close: true,
};

describe('arcs', () => {
  it('finds an arc’s circle from its ends and bulge', () => {
    // A quarter circle counter-clockwise from (1, 0) to (0, 1).
    const arc = arcOf({ x: 1, y: 0 }, { x: 0, y: 1 }, Math.tan(Math.PI / 8));
    expect(arc.center.x).toBeCloseTo(0, 12);
    expect(arc.center.y).toBeCloseTo(0, 12);
    expect(arc.radius).toBeCloseTo(1, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
    // The same ends the other way round is three quarters, clockwise.
    const back = bulgeAround(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      false,
    );
    expect(4 * Math.atan(back)).toBeCloseTo((-3 * Math.PI) / 2, 12);
  });

  it('measures lengths and areas exactly', () => {
    expect(segmentLength({ x: -1, y: 0 }, { x: 1, y: 0 }, 1)).toBeCloseTo(
      Math.PI,
      12,
    );
    expect(polygonLength(circle(0, 0, 2))).toBeCloseTo(4 * Math.PI, 12);
    expect(signedArea(circle(3, 4, 2))).toBeCloseTo(4 * Math.PI, 12);
    expect(signedArea(reversePolygon(circle(3, 4, 2)))).toBeCloseTo(
      -4 * Math.PI,
      12,
    );
    expect(signedArea(slot)).toBeCloseTo(40 + 4 * Math.PI, 12);
    expect(signedArea(square)).toBe(100);
  });

  it('walks along arcs', () => {
    const a = { x: 1, y: 0 };
    const b = { x: -1, y: 0 };
    const top = pointAlong(a, b, 1, 0.5);
    expect(top.x).toBeCloseTo(0, 12);
    expect(top.y).toBeCloseTo(1, 12);
    expect(paramOnSegment(a, b, 1, { x: 0, y: 1 })).toBeCloseTo(0.5, 12);
    expect(paramOnSegment(a, b, 1, a)).toBe(0);
    // Leaving (1, 0) counter-clockwise: straight up.
    const t = tangentAt(a, b, 1, 0);
    expect(t.x).toBeCloseTo(0, 12);
    expect(t.y).toBeCloseTo(1, 12);
    const mid = tangentAlong(a, b, 1, 0.5);
    expect(mid.x).toBeCloseTo(-1, 12);
  });

  it('bounds arcs by their extreme points, not their ends', () => {
    const box = polygonsBounds([circle(5, 5, 2)]);
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([3, 3, 7, 7]);
    const slotBox = polygonsBounds([slot]);
    expect(slotBox.minX).toBeCloseTo(-2, 12);
    expect(slotBox.maxX).toBeCloseTo(12, 12);
  });

  it('reverses polygons, arcs included', () => {
    const back = reversePolygon(slot);
    expect(signedArea(back)).toBeCloseTo(-signedArea(slot), 12);
    expect(reversePolygon(back)).toEqual(slot);
    const open = reversePolygon({
      vertices: slot.vertices.slice(0, 3),
      close: false,
    });
    expect(open.vertices.map((v) => v.x)).toEqual([10, 10, 0]);
    // The arc that ran into (10, 4) now runs out of it, the other way.
    expect(open.vertices[0].bulge).toBe(-1);
    expect(open.vertices[1].bulge).toBeUndefined();
  });

  it('keeps arcs under rotation and mirroring, not under stretching', () => {
    const turned = transformPolygon(circle(0, 0, 1), [0, 1, -1, 0, 5, 0]);
    expect(turned.vertices.every((v) => v.bulge === 1)).toBeTrue();
    const mirrored = transformPolygon(circle(0, 0, 1), [-1, 0, 0, 1, 0, 0]);
    expect(mirrored.vertices.every((v) => v.bulge === -1)).toBeTrue();
    expect(signedArea(mirrored)).toBeCloseTo(-Math.PI, 12);
    const stretched = transformPolygon(
      circle(0, 0, 1),
      [2, 0, 0, 1, 0, 0],
      0.001,
    );
    expect(stretched.vertices.some((v) => v.bulge)).toBeFalse();
    // An ellipse of 2 × 1: area 2π.
    expect(signedArea(stretched)).toBeCloseTo(2 * Math.PI, 2);
  });

  it('turns arcs into points within the tolerance', () => {
    const points = polygonPoints(circle(0, 0, 10), 0.01);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(10, 9);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(0.01 + 1e-12);
    }
  });

  it('finds distances and winding numbers with arcs', () => {
    expect(distanceToPolygons({ x: 0, y: 0 }, [circle(0, 0, 3)])).toBeCloseTo(
      3,
      12,
    );
    expect(
      closestOnSegment({ x: 0, y: 5 }, { x: 1, y: 0 }, { x: -1, y: 0 }, 1)
        .distance,
    ).toBeCloseTo(4, 12);
    expect(windingNumber({ x: 0, y: 0.99 }, [circle(0, 0, 1)])).toBe(1);
    expect(windingNumber({ x: 0, y: 1.01 }, [circle(0, 0, 1)])).toBe(0);
    expect(windingNumber({ x: 0.7, y: -0.7 }, [circle(0, 0, 1)])).toBe(1);
    expect(windingNumber({ x: -1.5, y: 2 }, [slot])).toBe(1);
    expect(windingNumber({ x: -2.5, y: 2 }, [slot])).toBe(0);
  });

  it('tells areas from lines', () => {
    expect(isArea(circle(0, 0, 1))).toBeTrue();
    expect(isArea(square)).toBeTrue();
    expect(
      isArea({
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        close: true,
      }),
    ).toBeFalse();
    expect(isArea({ ...square, close: false })).toBeFalse();
  });
});
