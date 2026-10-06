import { CamPoint, CamShape } from '../../cam/types';
import { findCorners } from '../../cam/corners';
import {
  centerMarks,
  fitToSize,
  getBoundingBox,
  mirrorCopy,
  polarArray,
  shapeCorners,
} from './shape-transforms';

const square = (x: number, y: number, size: number): CamPoint[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const shape = (...polygons: CamPoint[][]): CamShape[] => [
  {
    sourceShapeId: 's',
    polygons: polygons.map((points) => ({ points, close: true })),
  },
];

describe('findCorners', () => {
  it('tells outside corners from a hole’s', () => {
    const [outer, hole] = findCorners(
      shape(square(0, 0, 10), square(3, 3, 4).reverse())[0].polygons,
    );
    expect(outer.corners.length).toBe(4);
    expect(outer.corners.every((c) => c.convex)).toBeTrue();
    expect(hole.corners.every((c) => c.convex === false)).toBeTrue();
    // Whichever way the hole runs.
    const [, sameWay] = findCorners(
      shape(square(0, 0, 10), square(3, 3, 4))[0].polygons,
    );
    expect(sameWay.corners.every((c) => c.convex === false)).toBeTrue();
  });

  it('finds an L-shape’s inside corner', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    const [{ corners }] = findCorners(shape(l)[0].polygons);
    const concave = corners.filter((c) => !c.convex);
    expect(concave.length).toBe(1);
    expect(concave[0].point).toEqual({ x: 5, y: 5 });
    // Its bisector points out of the L, towards (10, 10).
    expect(concave[0].bisector.x).toBeGreaterThan(0);
    expect(concave[0].bisector.y).toBeGreaterThan(0);
  });
});

describe('shapeCorners', () => {
  it('chamfers each corner by the size along both edges', () => {
    const [result] = shapeCorners(shape(square(0, 0, 10)), {
      type: 'corners',
      cornerMode: 'chamfer',
      cornerSize: 2,
      cornerWhich: 'all',
      cornerMaxAngle: 160,
    });
    expect(result.polygons[0].points.length).toBe(8);
    expect(result.polygons[0].points[0]).toEqual({ x: 0, y: 2 });
    expect(result.polygons[0].points[1]).toEqual({ x: 2, y: 0 });
  });

  it('fillets corners with arcs tangent to the edges', () => {
    const [result] = shapeCorners(shape(square(0, 0, 10)), {
      type: 'corners',
      cornerMode: 'fillet',
      cornerSize: 3,
      cornerWhich: 'convex',
      cornerMaxAngle: 160,
    });
    const points = result.polygons[0].points;
    // Every point of the first corner's arc is 3 from (3, 3).
    const arc = points.filter((p) => p.x <= 3 + 1e-9 && p.y <= 3 + 1e-9);
    expect(arc.length).toBeGreaterThan(3);
    for (const p of arc) {
      expect(Math.hypot(p.x - 3, p.y - 3)).toBeCloseTo(3, 9);
    }
  });

  it('leaves unselected corners alone', () => {
    const [result] = shapeCorners(shape(square(0, 0, 10)), {
      type: 'corners',
      cornerMode: 'fillet',
      cornerSize: 3,
      cornerWhich: 'concave',
      cornerMaxAngle: 160,
    });
    expect(result.polygons[0].points).toEqual(square(0, 0, 10));
  });
});

describe('polarArray', () => {
  it('spaces copies evenly round a point', () => {
    const result = polarArray(shape(square(9, -1, 2)), {
      type: 'polar',
      polarCount: 4,
      polarAngle: 360,
      polarAround: 'point',
      polarX: 0,
      polarY: 0,
      polarRotate: true,
    });
    expect(result.length).toBe(4);
    const centers = result.map((s) => {
      const b = getBoundingBox([s]);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    expect(centers[1].x).toBeCloseTo(0, 9);
    expect(centers[1].y).toBeCloseTo(10, 9); // counter-clockwise
    expect(centers[2].x).toBeCloseTo(-10, 9);
  });

  it('spreads copies over a part of a turn, ends included', () => {
    const result = polarArray(shape(square(9, -1, 2)), {
      type: 'polar',
      polarCount: 3,
      polarAngle: 90,
      polarAround: 'point',
      polarX: 0,
      polarY: 0,
      polarRotate: false,
    });
    const last = getBoundingBox([result[2]]);
    expect(last.x + 1).toBeCloseTo(0, 9);
    expect(last.y + 1).toBeCloseTo(10, 9);
    // Moved, not turned: still axis-aligned 2 × 2.
    expect(last.width).toBeCloseTo(2, 9);
  });
});

describe('fitToSize', () => {
  it('scales to a width, keeping proportions and the bottom left', () => {
    const [result] = fitToSize(shape(square(5, 5, 10)), {
      type: 'fit',
      fitWidth: 40,
      fitHeight: null,
      fitKeepAspect: true,
      fitAround: 'xmin-ymin',
    });
    expect(getBoundingBox([result])).toEqual({
      x: 5,
      y: 5,
      width: 40,
      height: 40,
    });
  });

  it('fits within both sizes', () => {
    const [result] = fitToSize(shape(square(0, 0, 10)), {
      type: 'fit',
      fitWidth: 40,
      fitHeight: 20,
      fitKeepAspect: true,
      fitAround: 'xmin-ymin',
    });
    expect(getBoundingBox([result]).width).toBeCloseTo(20, 9);
  });
});

describe('mirrorCopy', () => {
  it('adds the mirror image across the right side', () => {
    const result = mirrorCopy(shape(square(0, 0, 10)), {
      type: 'mirror',
      mirrorAxis: 'vertical',
      mirrorAt: 'max',
      mirrorValue: 0,
      mirrorKeepOriginal: true,
    });
    expect(result.length).toBe(2);
    expect(getBoundingBox(result)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
  });
});

describe('centerMarks', () => {
  it('marks outlines with points, skipping holes', () => {
    const [result] = centerMarks(shape(square(0, 0, 10), square(2, 2, 2)), {
      type: 'centers',
      centersRadius: 0,
      centersOf: 'outlines',
      centersKeepOriginal: false,
    });
    expect(result.polygons).toEqual([
      { points: [{ x: 5, y: 5 }], close: false },
    ]);
  });
});
