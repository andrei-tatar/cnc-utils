import { DEFAULT_STOCK } from './stock';
import {
  CheckedOperation,
  checkJob,
  pathHits,
  segmentDistance,
  sharpCorners,
} from './job-checks';
import { CamPath, CamPolygon, CamShape } from './types';

const square = (x: number, y: number, size: number): CamPolygon => ({
  vertices: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
  close: true,
});

const shape: CamShape[] = [
  { sourceShapeId: 's', polygons: [square(0, 0, 50)] },
];

const op = (over: Partial<CheckedOperation> = {}): CheckedOperation => ({
  id: 'op',
  name: 'profile',
  type: 'profile',
  bitType: 'end-mill',
  toolDiameter: 6,
  fluteLength: 0,
  depthPerStep: 3,
  engagement: null,
  roundsCorners: null,
  shape,
  cornersHandled: false,
  cutsOut: false,
  onionSkin: false,
  ...over,
});

const cut = (
  z: number,
  points = [
    { x: -3, y: -3 },
    { x: 53, y: -3 },
  ],
): CamPath => ({
  sourceShapeId: 's',
  sourceOperationId: 'op',
  type: 'carve',
  points: points.map((p) => ({ ...p, z })),
});

describe('checkJob', () => {
  const stock = { ...DEFAULT_STOCK, enabled: true, thickness: 18 };

  it('flags cuts into the spoilboard and past the flutes', () => {
    const warnings = checkJob({
      stock,
      operations: [op({ fluteLength: 15 })],
      paths: [cut(-19)],
      keepOuts: [],
    });
    expect(warnings.map((w) => w.text)).toEqual([
      'profile: cuts 1 mm into the spoilboard',
      'profile: goes 19 mm deep, past the bit’s 15 mm flutes',
    ]);
  });

  it('notes parts cut free without tabs, unless there are tabs or a skin', () => {
    const run = (o: Partial<CheckedOperation>) =>
      checkJob({
        stock,
        operations: [op({ cutsOut: true, ...o })],
        paths: [cut(-18)],
        keepOuts: [],
      });
    expect(run({}).length).toBe(1);
    expect(run({ onionSkin: true }).length).toBe(0);
    expect(
      run({ shape: [{ ...shape[0], tabs: [{ points: [], top: -15 }] }] })
        .length,
    ).toBe(0);
  });

  it('notes corners a pocket leaves rounded', () => {
    const warnings = checkJob({
      stock,
      operations: [op({ type: 'pocket', roundsCorners: 'convex' })],
      paths: [cut(-5)],
      keepOuts: [],
    });
    expect(warnings[0].text).toContain('4 corners come out rounded (r3)');
    expect(sharpCorners(shape, 'concave')).toBe(0);
    // Only the corners on a part count, when parts are cut out.
    expect(sharpCorners(shape, 'convex', [square(-10, -10, 30)])).toBe(1);
    // A part's own corners, on its outline, count too.
    const part = square(0, 0, 10);
    expect(
      sharpCorners([{ sourceShapeId: 'p', polygons: [part] }], 'convex', [
        part,
      ]),
    ).toBe(4);
  });

  it('allows a few tenths into the spoilboard', () => {
    const run = (z: number) =>
      checkJob({ stock, operations: [op()], paths: [cut(z)], keepOuts: [] });
    expect(run(-18.5)).toEqual([]);
    expect(run(-18.6).length).toBe(1);
  });

  it('warns when a cut comes near a clamp', () => {
    const clamp = { name: 'front', polygons: [square(10, -15, 10)] };
    const warnings = checkJob({
      stock,
      operations: [op()],
      paths: [cut(-5)],
      keepOuts: [clamp],
    });
    expect(warnings[0].text).toBe(
      'profile: comes within reach of the clamp “front”',
    );
    const far = { name: 'far', polygons: [square(10, -40, 10)] };
    expect(
      checkJob({
        stock,
        operations: [op()],
        paths: [cut(-5)],
        keepOuts: [far],
      }),
    ).toEqual([]);
  });
});

describe('pathHits', () => {
  it('counts the bit’s radius', () => {
    const polygons = [square(0, 0, 10)];
    const path = [
      { x: -5, y: 12 },
      { x: 15, y: 12 },
    ];
    expect(pathHits(path, polygons, 1)).toBeFalse();
    expect(pathHits(path, polygons, 2.5)).toBeTrue();
    expect(pathHits([{ x: 5, y: 5 }], polygons, 0)).toBeTrue();
  });

  it('measures crossing segments as touching', () => {
    expect(
      segmentDistance(
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 2, y: 0 },
      ),
    ).toBe(0);
  });
});
