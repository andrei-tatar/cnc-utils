import { CamPoint, CamShape } from '../../cam/types';
import { findCorners } from '../../cam/corners';
import { arcOf } from '../../cam/arcs';
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
    polygons: polygons.map((vertices) => ({ vertices, close: true })),
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
    const [first, second] = result.polygons[0].vertices;
    expect(result.polygons[0].vertices.length).toBe(8);
    expect(first.x).toBeCloseTo(0, 12);
    expect(first.y).toBeCloseTo(2, 12);
    expect(second.x).toBeCloseTo(2, 12);
    expect(second.y).toBeCloseTo(0, 12);
    expect(result.polygons[0].vertices.some((v) => v.bulge)).toBeFalse();
  });

  it('fillets corners with arcs tangent to the edges', () => {
    const [result] = shapeCorners(shape(square(0, 0, 10)), {
      type: 'corners',
      cornerMode: 'fillet',
      cornerSize: 3,
      cornerWhich: 'convex',
      cornerMaxAngle: 160,
    });
    const vertices = result.polygons[0].vertices;
    // Each corner becomes a quarter circle of radius 3: the first one's
    // centre is (3, 3), turning left round it.
    expect(vertices.length).toBe(8);
    const [start, end] = vertices;
    expect(start.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    const { center, radius } = arcOf(start, end, start.bulge!);
    expect(center.x).toBeCloseTo(3, 9);
    expect(center.y).toBeCloseTo(3, 9);
    expect(radius).toBeCloseTo(3, 9);
  });

  it('leaves unselected corners alone', () => {
    const [result] = shapeCorners(shape(square(0, 0, 10)), {
      type: 'corners',
      cornerMode: 'fillet',
      cornerSize: 3,
      cornerWhich: 'concave',
      cornerMaxAngle: 160,
    });
    expect(result.polygons[0].vertices).toEqual(square(0, 0, 10));
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
    expect(result.polygons.length).toBe(1);
    const [mark] = result.polygons;
    expect(mark.close).toBeFalse();
    expect(mark.vertices.length).toBe(1);
    expect(mark.vertices[0].x).toBeCloseTo(5, 12);
    expect(mark.vertices[0].y).toBeCloseTo(5, 12);
  });
});
