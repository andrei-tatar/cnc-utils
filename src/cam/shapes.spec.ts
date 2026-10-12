import {
  boxPanelOutline,
  fingerCount,
  mortiseRects,
  tenonSpans,
} from './box-joints';
import { fromPoints, windingNumber } from './arcs';
import { traceContours } from './marching-squares';
import { circlePoints, finitePoints, gridPoints } from './point-patterns';
import { signedArea2 } from './polygon-nesting';

describe('finitePoints', () => {
  it('keeps the points whose coordinates were worked out', () => {
    expect(
      finitePoints([
        { x: 1, y: 2 },
        { x: null, y: 3 },
        { x: 4, y: 'a' },
        null,
        { x: -5, y: 0.5 },
      ]),
    ).toEqual([
      { x: 1, y: 2 },
      { x: -5, y: 0.5 },
    ]);
    expect(finitePoints(undefined)).toEqual([]);
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

describe('panel joints', () => {
  const panel = (edges: any, extra: any = {}) =>
    boxPanelOutline({
      width: 120,
      height: 80,
      thickness: 6,
      fingerWidth: 12,
      play: 0.2,
      edges,
      tenons: { count: 2, width: 20, margin: 15 },
      dovetails: { count: 3, angle: 10 },
      ...extra,
    });

  it('puts tenons where their mortises are', () => {
    const outline = panel(['tenons', 'flat', 'flat', 'flat']);
    // Standing out from the body (6 in) to the outer size, at the spans.
    const at = (x: number, y: number) =>
      outline.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
    for (const [from, to] of [
      [15, 35],
      [85, 105],
    ]) {
      expect(at(from, 0)).withContext(`tenon at ${from}`).toBe(true);
      expect(at(to, 0)).withContext(`tenon to ${to}`).toBe(true);
    }
    expect(tenonSpans(120, { count: 2, width: 20, margin: 15 })).toEqual([
      { from: 15, to: 35 },
      { from: 85, to: 105 },
    ]);
    const mortises = mortiseRects(
      120,
      { count: 2, width: 20, margin: 15 },
      6,
      0.2,
    );
    expect(mortises.length).toBe(2);
    expect(mortises[0][0].x).toBeCloseTo(14.9, 9);
    expect(mortises[0][1].x).toBeCloseTo(35.1, 9);
    expect(mortises[0][2].y).toBeCloseTo(3.1, 9);
    // One tenon: in the middle.
    expect(tenonSpans(120, { count: 1, width: 20, margin: 15 })).toEqual([
      { from: 50, to: 70 },
    ]);
  });

  it('fits dovetail tails into sockets edge to edge, the play apart', () => {
    const tails = fromPoints(panel(['flat', 'tails', 'flat', 'flat']), true);
    // The sockets panel's left edge meets the tails panel's body, 6 in from
    // its outer size.
    const sockets = fromPoints(
      panel(['flat', 'flat', 'flat', 'sockets']).map((p) => ({
        x: p.x + 114,
        y: p.y,
      })),
      true,
    );
    let both = 0;
    let neither = 0;
    const step = 0.05;
    for (let x = 114 + step / 2; x < 120; x += step) {
      for (let y = step / 2; y < 80; y += step) {
        const inTails = windingNumber({ x, y }, [tails]) !== 0;
        const inSockets = windingNumber({ x, y }, [sockets]) !== 0;
        if (inTails && inSockets) both++;
        if (!inTails && !inSockets) neither++;
      }
    }
    expect(both).toBe(0);
    // The gap: a quarter of the play each side of each tail, along each of
    // its two slanted sides (6 deep, leaning 10°) and its end and root.
    const gapArea = neither * step * step;
    expect(gapArea).toBeGreaterThan(1);
    expect(gapArea).toBeLessThan(6 * 0.2 * 3 * 1.5);
    // Locked: the tails are wider at their ends than at their roots.
    const xs = tails.vertices.filter((v) => v.x > 119.99).map((v) => v.y);
    expect(xs.length).toBe(6);
  });
});
