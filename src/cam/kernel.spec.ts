import {
  booleanOperation,
  clipOpenPaths,
  inflatePaths,
  normalize,
  offsetPaths,
  offsetRegion,
} from './kernel';
import { fromPoints, polygonLength, signedArea } from './arcs';
import { CamPolygon } from './types';

// The real WebAssembly kernel, as the app loads it (an asset of the test
// build too).

const square = (x: number, y: number, size: number): CamPolygon =>
  fromPoints(
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    true,
  );

const circle = (cx: number, cy: number, r: number): CamPolygon => ({
  vertices: [
    { x: cx - r, y: cy, bulge: 1 },
    { x: cx + r, y: cy, bulge: 1 },
  ],
  close: true,
});

const total = (polygons: CamPolygon[]) =>
  polygons.reduce((sum, p) => sum + signedArea(p), 0);

describe('kernel', () => {
  it('combines regions', async () => {
    const a = [square(0, 0, 10)];
    const b = [square(5, 5, 10)];
    expect(total(await booleanOperation(a, b, 'union'))).toBeCloseTo(175, 9);
    expect(total(await booleanOperation(a, b, 'intersection'))).toBeCloseTo(
      25,
      9,
    );
    expect(total(await booleanOperation(a, b, 'difference'))).toBeCloseTo(
      75,
      9,
    );
    expect(total(await booleanOperation(a, b, 'xor'))).toBeCloseTo(150, 9);
  });

  it('keeps circles as arcs through booleans', async () => {
    const union = await booleanOperation(
      [circle(0, 0, 5)],
      [circle(6, 0, 5)],
      'union',
    );
    expect(union.length).toBe(1);
    expect(union[0].vertices.every((v) => v.bulge)).toBeTrue();
    const holed = await booleanOperation(
      [square(-10, -10, 20)],
      [circle(0, 0, 3)],
      'difference',
    );
    expect(holed.length).toBe(2);
    expect(total(holed)).toBeCloseTo(400 - 9 * Math.PI, 9);
  });

  it('reads overlapping loops by the fill rule', async () => {
    const loops = [square(0, 0, 10), square(5, 5, 10)];
    expect(total(await normalize(loops, 'even-odd'))).toBeCloseTo(150, 9);
    expect(total(await normalize(loops, 'non-zero'))).toBeCloseTo(175, 9);
  });

  it('offsets regions exactly, corners round', async () => {
    const grown = await offsetRegion([square(0, 0, 10)], 1);
    expect(total(grown)).toBeCloseTo(100 + 40 + Math.PI, 9);
    expect(grown[0].vertices.filter((v) => v.bulge).length).toBe(4);
    const shrunk = await offsetRegion([circle(0, 0, 5)], -2);
    expect(total(shrunk)).toBeCloseTo(9 * Math.PI, 9);
    expect(await offsetRegion([square(0, 0, 10)], -6)).toEqual([]);
  });

  it('inflates like Clipper did: joins and ends', async () => {
    const miter = await inflatePaths(
      [square(0, 0, 10)],
      1,
      'miter',
      'polygon',
      2,
    );
    expect(total(miter)).toBeCloseTo(144, 9);
    const line = fromPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    expect(total(await inflatePaths([line], 1, 'round', 'round'))).toBeCloseTo(
      20 + Math.PI,
      9,
    );
    expect(total(await inflatePaths([line], 1, 'round', 'butt'))).toBeCloseTo(
      20,
      9,
    );
    expect(
      total(await inflatePaths([line], 1, 'square', 'square')),
    ).toBeCloseTo(24, 9);
  });

  it('clips open paths to a region', async () => {
    const line = fromPoints(
      [
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ],
      false,
    );
    const inside = await clipOpenPaths([line], [square(0, 0, 10)]);
    expect(inside.reduce((s, p) => s + polygonLength(p), 0)).toBeCloseTo(10, 9);
  });

  it('offsets a path to one side', async () => {
    const line = fromPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    const [left] = await offsetPaths([line], 2);
    expect(left.vertices.every((v) => Math.abs(v.y - 2) < 1e-9)).toBeTrue();
  });
});
