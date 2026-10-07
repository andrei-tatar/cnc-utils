import { simplifyPoints, simplifyPolygon } from './simplify';
import { closestOnSegment } from './arcs';
import { CamPoint } from './types';

describe('simplify', () => {
  it('drops points within the tolerance of the line, keeping the rest', () => {
    const wiggly: CamPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.004 },
      { x: 2, y: -0.003 },
      { x: 3, y: 0 },
      { x: 3, y: 5 },
    ];
    expect(simplifyPoints(wiggly, 0.01, false)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 5 },
    ]);
    // The points kept are among the originals: none moves.
    for (const p of simplifyPoints(wiggly, 0.01, false)) {
      expect(wiggly).toContain(p);
    }
  });

  it('stays within the tolerance of a closed path', () => {
    const n = 400;
    const loop = Array.from({ length: n }, (_, i) => ({
      x: 10 * Math.cos((2 * Math.PI * i) / n),
      y: 10 * Math.sin((2 * Math.PI * i) / n),
    }));
    const simple = simplifyPoints(loop, 0.05, true);
    expect(simple.length).toBeLessThan(n / 4);
    for (const p of loop) {
      let nearest = Infinity;
      for (let i = 0; i < simple.length; i++) {
        nearest = Math.min(
          nearest,
          closestOnSegment(p, simple[i], simple[(i + 1) % simple.length])
            .distance,
        );
      }
      expect(nearest).toBeLessThanOrEqual(0.05 + 1e-12);
    }
  });

  it('keeps arcs as they are, simplifying the lines between them', () => {
    const polygon = {
      close: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 5, y: 0.001 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 4 },
        { x: 0, y: 4, bulge: 1 },
      ],
    };
    const simple = simplifyPolygon(polygon, 0.01);
    expect(simple.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0, bulge: 1 },
      { x: 10, y: 4 },
      { x: 0, y: 4, bulge: 1 },
    ]);
  });
});
