import { biarc, circularArc, cubic, fitBiarcs, quadratic } from './biarc';
import { closestOnSegment, tangentAt } from './arcs';
import { CamPoint, CamVertex } from './types';

/** The worst distance from the curve's points to the fitted path. */
function strayOf(
  curve: { point(t: number): CamPoint },
  vertices: CamVertex[],
  end: CamPoint,
) {
  const path: CamVertex[] = [...vertices, end];
  let worst = 0;
  for (let k = 0; k <= 200; k++) {
    const p = curve.point(k / 200);
    let nearest = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      nearest = Math.min(
        nearest,
        closestOnSegment(p, path[i], path[i + 1], path[i].bulge ?? 0).distance,
      );
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

describe('biarcs', () => {
  it('joins two arcs smoothly between given tangents', () => {
    const [a, b] = biarc(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 1 },
    );
    const end = { x: 10, y: 5 };
    // Leaves along the first tangent, arrives along the second, and the
    // arcs meet with the same direction.
    const leave = tangentAt(a, b, a.bulge!, 0);
    expect(leave.x).toBeCloseTo(1, 9);
    const arrive = tangentAt(b, end, b.bulge!, 1);
    expect(arrive.y).toBeCloseTo(1, 9);
    const join1 = tangentAt(a, b, a.bulge!, 1);
    const join2 = tangentAt(b, end, b.bulge!, 0);
    expect(join1.x).toBeCloseTo(join2.x, 9);
    expect(join1.y).toBeCloseTo(join2.y, 9);
  });

  it('is a straight line along the chord', () => {
    expect(
      biarc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }, { x: 1, y: 0 }),
    ).toEqual([{ x: 0, y: 0 }]);
  });

  it('fits quadratic and cubic Béziers within the tolerance', () => {
    const q = quadratic({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
    const qv = fitBiarcs(q, 0.005);
    expect(strayOf(q, qv, { x: 10, y: 0 })).toBeLessThan(0.006);
    // An S curve (an inflection) too.
    const c = cubic(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    );
    const cv = fitBiarcs(c, 0.005);
    expect(strayOf(c, cv, { x: 10, y: 0 })).toBeLessThan(0.006);
    // Far fewer pieces than points at that tolerance.
    expect(cv.length).toBeLessThan(60);
  });

  it('makes circular arcs of at most a half turn each', () => {
    const full = circularArc({ x: 0, y: 0 }, 2, 0, 2 * Math.PI);
    expect(full.length).toBe(2);
    expect(full.every((v) => Math.abs(v.bulge! - 1) < 1e-12)).toBeTrue();
    const quarter = circularArc({ x: 0, y: 0 }, 2, 0, -Math.PI / 2);
    expect(quarter.length).toBe(1);
    expect(quarter[0].bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
  });
});

describe('closed curves', () => {
  it('fits a whole ellipse, which ends where it starts', () => {
    const ellipse = {
      point: (t: number) => ({
        x: 12 * Math.cos(2 * Math.PI * t),
        y: 8 * Math.sin(2 * Math.PI * t),
      }),
      tangent: (t: number) => ({
        x: -12 * Math.sin(2 * Math.PI * t),
        y: 8 * Math.cos(2 * Math.PI * t),
      }),
    };
    const vertices = fitBiarcs(ellipse, 0.005);
    expect(vertices.length).toBeGreaterThan(4);
    expect(strayOf(ellipse, vertices, { x: 12, y: 0 })).toBeLessThan(0.006);
  });
});
