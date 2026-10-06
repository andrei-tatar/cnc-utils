import { boxPanelOutline, fingerCount } from './box-joints';
import { traceContours } from './marching-squares';
import { circlePoints, gridPoints, parsePointList } from './point-patterns';
import { signedArea2 } from './polygon-nesting';

describe('parsePointList', () => {
  it('reads points in any common separator, skipping other lines', () => {
    expect(parsePointList('x,y\n1, 2\n3 4\n5;6\n\t7\t8\nfoo')).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
  });
});

describe('point patterns', () => {
  it('lays out a grid from the origin', () => {
    expect(gridPoints(2, 2, 10, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
  });

  it('spaces points round a circle', () => {
    const [a, b] = circlePoints(4, 20, 90);
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.y).toBeCloseTo(10, 9);
    expect(b.x).toBeCloseTo(-10, 9);
  });
});

describe('box panel', () => {
  it('uses an odd finger count', () => {
    expect(fingerCount(100, 10)).toBe(9);
    expect(fingerCount(100, 12)).toBe(9);
    expect(fingerCount(100, 30)).toBe(3);
  });

  it('is a plain rectangle with flat edges', () => {
    const outline = boxPanelOutline({
      width: 50,
      height: 30,
      thickness: 6,
      fingerWidth: 10,
      play: 0,
      edges: ['flat', 'flat', 'flat', 'flat'],
    });
    expect(outline).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 },
      { x: 0, y: 30 },
    ]);
  });

  it('takes the slots out of the area', () => {
    const t = 6;
    const outline = boxPanelOutline({
      width: 90,
      height: 30,
      thickness: t,
      fingerWidth: 10,
      play: 0,
      edges: ['slots', 'flat', 'flat', 'flat'],
    });
    // 9 fingers of 10 mm along the bottom: 5 slots, 6 mm deep.
    expect(signedArea2(outline) / 2).toBeCloseTo(90 * 30 - 5 * 10 * t, 9);
  });

  it('makes mating edges that fit', () => {
    const panel = (bottom: 'tabs' | 'slots') =>
      boxPanelOutline({
        width: 70,
        height: 20,
        thickness: 5,
        fingerWidth: 10,
        play: 0,
        edges: [bottom, 'flat', 'flat', 'flat'],
      });
    const area = (p: { x: number; y: number }[]) => signedArea2(p) / 2;
    // 7 fingers: tabs keep 4 and lose 3, slots lose 4: together exactly one
    // thickness strip is missing.
    expect(area(panel('tabs')) + area(panel('slots'))).toBeCloseTo(
      2 * 70 * 20 - 70 * 5,
      9,
    );
  });
});

describe('traceContours', () => {
  it('traces a filled square as one loop, between pixel centres', () => {
    const w = 6;
    const h = 6;
    const field = new Float32Array(w * h).fill(-1);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) field[y * w + x] = 1;
    }
    const loops = traceContours(field, w, h);
    expect(loops.length).toBe(1);
    // Halfway between inside and outside samples: a 3 × 3 square
    // (diamond-cut at the corners).
    const xs = loops[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(3.5, 9);
  });

  it('traces a ring as two loops', () => {
    const w = 7;
    const h = 7;
    const field = new Float32Array(w * h).fill(-1);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        field[y * w + x] = x === 3 && y === 3 ? -1 : 1;
      }
    }
    expect(traceContours(field, w, h).length).toBe(2);
  });

  it('closes shapes touching the image edge', () => {
    const field = new Float32Array(4 * 4).fill(1);
    const loops = traceContours(field, 4, 4);
    expect(loops.length).toBe(1);
  });
});
