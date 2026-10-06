import { GCodeBuilder } from '../cam/gcode-builder';
import { CamShape } from '../cam/types';
import { pack, transferables, unpack } from './codec';
import { hashValue } from './result-cache';

const shape: CamShape = {
  sourceShapeId: 's1',
  polygons: [
    {
      close: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1.5 },
      ],
    },
    { close: false, points: [{ x: -2, y: 3 }] },
  ],
};

describe('codec', () => {
  it('round-trips shapes inside arguments', () => {
    const args = [[shape], { depth: 3, nested: [shape] }, 'x', null];
    expect(unpack(structuredClone(pack(args)))).toEqual(args);
  });

  it('packs shape points into typed arrays', () => {
    const packed = pack(shape) as any;
    expect(packed.coords instanceof Float64Array).toBeTrue();
    expect(transferables(packed).length).toBe(3);
  });

  it('leaves look-alikes with extra fields alone', () => {
    const odd = { ...shape, extra: 1 };
    expect(pack(odd)).toEqual(odd);
    const oddPoints = {
      sourceShapeId: 'x',
      polygons: [{ close: true, points: [{ x: 1, y: 2, d: 3 }] }],
    };
    expect(pack(oddPoints)).toEqual(oddPoints);
  });

  it('round-trips builders', () => {
    const b = new GCodeBuilder().travelTo(1, 2).plunge(-1).carveTo(3, 4);
    const back = unpack(structuredClone(pack(b))) as GCodeBuilder;
    expect(back instanceof GCodeBuilder).toBeTrue();
    expect(back.build()).toEqual(b.build());
  });
});

describe('hashValue', () => {
  it('ignores key order', () => {
    expect(hashValue({ a: 1, b: [2, 'x'] }, 'v')).toEqual(
      hashValue({ b: [2, 'x'], a: 1 }, 'v'),
    );
  });

  it('tells apart small differences', () => {
    const base = pack([shape]);
    const moved = pack([
      {
        ...shape,
        polygons: [{ ...shape.polygons[0], points: [{ x: 0, y: 1e-9 }] }],
      },
    ]);
    const hashes = new Set([
      hashValue(base, 'v'),
      hashValue(moved, 'v'),
      hashValue(base, 'w'),
      hashValue({ a: 1 }, 'v'),
      hashValue({ a: '1' }, 'v'),
      hashValue([1, 2], 'v'),
      hashValue([2, 1], 'v'),
      hashValue('ab', 'v'),
      hashValue('ba', 'v'),
    ]);
    expect(hashes.size).toBe(9);
  });
});
