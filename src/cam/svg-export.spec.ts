import { fitOutline, Outline, pathData, shapesToSvg } from './svg-export';
import { CamPoint, CamPolygon } from './types';

const TOLERANCE = { points: 0.01, chords: 0.02 };

function ellipse(rx: number, ry: number, count: number): CamPolygon {
  return {
    points: Array.from({ length: count }, (_, i) => {
      const a = (2 * Math.PI * i) / count;
      return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    }),
    close: true,
  };
}

/** Points along the outline, densely. */
function sample(outline: Outline): CamPoint[] {
  const out: CamPoint[] = [outline.start];
  let at = outline.start;
  for (const s of outline.segments) {
    for (let k = 1; k <= 200; k++) {
      const t = k / 200;
      if (s.type === 'line') {
        out.push({
          x: at.x + (s.to.x - at.x) * t,
          y: at.y + (s.to.y - at.y) * t,
        });
      } else if (s.type === 'cubic') {
        const b = 1 - t;
        const w = [b * b * b, 3 * t * b * b, 3 * t * t * b, t * t * t];
        const p = [at, s.c1, s.c2, s.to];
        out.push({
          x: p.reduce((v, q, i) => v + q.x * w[i], 0),
          y: p.reduce((v, q, i) => v + q.y * w[i], 0),
        });
      } else {
        const r = Math.hypot(at.x - s.center.x, at.y - s.center.y);
        const a0 = Math.atan2(at.y - s.center.y, at.x - s.center.x);
        const a1 = Math.atan2(s.to.y - s.center.y, s.to.x - s.center.x);
        let sweep = a1 - a0;
        if (s.clockwise) while (sweep > 0) sweep -= 2 * Math.PI;
        else while (sweep < 0) sweep += 2 * Math.PI;
        const a = a0 + sweep * t;
        out.push({
          x: s.center.x + r * Math.cos(a),
          y: s.center.y + r * Math.sin(a),
        });
      }
    }
    at = s.to;
  }
  return out;
}

/** The largest distance from one of `points` to the polyline `path`. */
function farthest(points: CamPoint[], path: CamPoint[]): number {
  const distance = (p: CamPoint, a: CamPoint, b: CamPoint) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  return Math.max(
    ...points.map((p) =>
      Math.min(...path.slice(1).map((b, i) => distance(p, path[i], b))),
    ),
  );
}

describe('fitOutline', () => {
  it('turns a circle into a couple of arcs', () => {
    const circle = ellipse(10, 10, 200);
    const outline = fitOutline(circle, TOLERANCE);
    expect(outline.segments.length).toBeLessThanOrEqual(3);
    expect(outline.segments.every((s) => s.type === 'arc')).toBeTrue();
    expect(farthest(circle.points, sample(outline))).toBeLessThan(0.02);
  });

  it('fits an ellipse with few Béziers, close to the points', () => {
    const shape = ellipse(30, 12, 400);
    const outline = fitOutline(shape, TOLERANCE, false);
    expect(outline.segments.length).toBeLessThan(20);
    expect(outline.segments.every((s) => s.type === 'cubic')).toBeTrue();
    expect(farthest(shape.points, sample(outline))).toBeLessThan(0.012);
  });

  it('keeps corners and straight sides', () => {
    const square: CamPolygon = {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      close: true,
    };
    const outline = fitOutline(square, TOLERANCE);
    // Three sides; "z" draws the fourth.
    expect(outline.segments.map((s) => s.type)).toEqual([
      'line',
      'line',
      'line',
    ]);
  });

  it('does not curve a coarse polygon', () => {
    // A 24-gon: its sides are far further than the tolerance from a circle.
    const polygon = ellipse(20, 20, 24);
    const outline = fitOutline(polygon, TOLERANCE);
    expect(outline.segments.every((s) => s.type === 'line')).toBeTrue();
  });

  it('leaves an open polyline open', () => {
    const line: CamPolygon = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      close: false,
    };
    expect(pathData([fitOutline(line, TOLERANCE)])).toBe('M0 0h10');
  });
});

describe('pathData', () => {
  it('writes relative moves without repeating commands', () => {
    const outline: Outline = {
      start: { x: 1, y: 1 },
      segments: [
        { type: 'line', to: { x: 2, y: 3 } },
        { type: 'line', to: { x: 1.5, y: 4 } },
      ],
      close: true,
    };
    expect(pathData([outline])).toBe('M1 1l1 2-0.5 1z');
  });

  it('writes arcs with the large-arc and sweep flags', () => {
    // Counter-clockwise (in the path's own coordinates) three quarters.
    const outline: Outline = {
      start: { x: 10, y: 0 },
      segments: [
        {
          type: 'arc',
          to: { x: 0, y: -10 },
          center: { x: 0, y: 0 },
          clockwise: false,
        },
      ],
      close: false,
    };
    expect(pathData([outline])).toBe('M10 0a10 10 0 1 1-10-10');
  });
});

describe('shapesToSvg', () => {
  it('is sized in millimetres', () => {
    const svg = shapesToSvg(
      [
        {
          sourceShapeId: 'a',
          polygons: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 0, y: 20 },
              ],
              close: true,
            },
          ],
        },
      ],
      TOLERANCE,
      'plate & co',
    );
    expect(svg).toContain('width="41mm" height="21mm" viewBox="0 0 41 21"');
    expect(svg).toContain('<title>plate &amp; co</title>');
    // Y is flipped: the design's bottom edge is at the bottom of the page.
    expect(svg).toContain('d="M0.5 20.5h40v-20h-40z"');
  });

  it('draws drill points as small circles', () => {
    const svg = shapesToSvg(
      [
        {
          sourceShapeId: 'p',
          polygons: [{ points: [{ x: 5, y: 5 }], close: false }],
        },
      ],
      TOLERANCE,
    );
    expect(svg).toContain('<circle cx="1" cy="1" r="0.5"');
  });
});
