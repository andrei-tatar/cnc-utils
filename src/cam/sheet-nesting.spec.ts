import { nestRectangles, placeShapes, shapesBox } from './sheet-nesting';
import { CamShape } from './types';

describe('nestRectangles', () => {
  const sheet = { width: 2440, height: 1220, margin: 10, gap: 8 };

  it('puts parts inside the margins without overlapping', () => {
    const { placements, unplaced, sheets } = nestRectangles(
      [
        { key: 'side', width: 720, height: 560, count: 2, rotate: true },
        { key: 'shelf', width: 764, height: 540, count: 3, rotate: true },
        { key: 'back', width: 400, height: 300, count: 1, rotate: false },
      ],
      sheet,
    );
    expect(unplaced).toEqual([]);
    expect(sheets).toBe(1);
    expect(placements.length).toBe(6);
    for (const a of placements) {
      expect(a.x).toBeGreaterThanOrEqual(10);
      expect(a.y).toBeGreaterThanOrEqual(10);
      expect(a.x + a.width).toBeLessThanOrEqual(2430 + 1e-9);
      expect(a.y + a.height).toBeLessThanOrEqual(1210 + 1e-9);
      for (const b of placements) {
        if (a === b) continue;
        const apart =
          a.x + a.width + 8 <= b.x + 1e-9 ||
          b.x + b.width + 8 <= a.x + 1e-9 ||
          a.y + a.height + 8 <= b.y + 1e-9 ||
          b.y + b.height + 8 <= a.y + 1e-9;
        expect(apart).toBeTrue();
      }
    }
  });

  it('starts another sheet when one is full, and reports parts too big', () => {
    const result = nestRectangles(
      [
        { key: 'big', width: 2000, height: 1000, count: 2, rotate: false },
        { key: 'huge', width: 3000, height: 100, count: 1, rotate: true },
      ],
      sheet,
    );
    expect(result.sheets).toBe(2);
    expect(result.placements.map((p) => p.sheet)).toEqual([0, 1]);
    expect(result.unplaced).toEqual([{ key: 'huge', copy: 0 }]);
  });

  it('turns a part only when allowed', () => {
    const tall = { key: 'tall', width: 100, height: 1500, count: 1 };
    expect(
      nestRectangles([{ ...tall, rotate: false }], sheet).unplaced.length,
    ).toBe(1);
    const turned = nestRectangles([{ ...tall, rotate: true }], sheet);
    expect(turned.placements[0].rotated).toBeTrue();
    expect(turned.placements[0].width).toBe(1500);
  });
});

describe('placeShapes', () => {
  const part: CamShape[] = [
    {
      sourceShapeId: 'p',
      polygons: [
        {
          close: true,
          points: [
            { x: 5, y: 5 },
            { x: 105, y: 5 },
            { x: 105, y: 55 },
            { x: 5, y: 55 },
          ],
        },
      ],
    },
  ];

  it('moves the part’s box corner to the spot', () => {
    const box = shapesBox(part)!;
    const [placed] = placeShapes(part, box, false, { x: 20, y: 30 }, 'n');
    expect(placed.sourceShapeId).toBe('n');
    expect(placed.polygons[0].points[0]).toEqual({ x: 20, y: 30 });
  });

  it('turns it a quarter turn into the same spot', () => {
    const box = shapesBox(part)!;
    const [placed] = placeShapes(part, box, true, { x: 0, y: 0 }, 'n');
    expect(shapesBox([placed])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 50,
      maxY: 100,
    });
  });
});
