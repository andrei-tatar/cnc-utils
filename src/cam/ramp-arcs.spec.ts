import { GCodeBuilder } from './gcode-builder';
import { enterCut } from './ramp';

describe('arcs through ramps', () => {
  it('writes a ramp along a circle as helical arcs ending at depth', () => {
    const loop = Array.from({ length: 120 }, (_, i) => ({
      x: 10 * Math.cos((2 * Math.PI * i) / 120),
      y: 10 * Math.sin((2 * Math.PI * i) / 120),
    }));
    const b = new GCodeBuilder();
    const points = enterCut(b, loop, true, 0, -2, 5, 6);
    for (const p of points.slice(1)) b.carveTo(p.x, p.y, -2);
    b.carveTo(points[0].x, points[0].y, -2);
    const lines = b.build({ header: false }).split('\n');
    const moves = lines.filter((l) => /^G[0123] /.test(l));
    // Far fewer lines than points, and the cut finishes at -2.
    expect(moves.length).toBeLessThan(40);
    const zs = moves
      .map((l) => /Z(-?[\d.]+)/.exec(l)?.[1])
      .filter((z): z is string => !!z)
      .map(Number);
    expect(Math.min(...zs)).toBe(-2);
    expect(zs[zs.length - 1]).toBe(-2);
  });
});
