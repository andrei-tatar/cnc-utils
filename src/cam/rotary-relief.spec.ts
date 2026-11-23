import { Rotary, wrapRadius } from './rotary';
import {
  radialDropCutter,
  radialTipSurface,
  unrolledRelief,
} from './rotary-relief';

describe('a model carved all round as the stock turns', () => {
  for (const along of ['x', 'y'] as const) {
    describe(`on an axis along ${along.toUpperCase()}`, () => {
      // A Ø40 blank, its axis across at 20.
      const rotary: Rotary = {
        along,
        across: 20,
        halfWidth: 20,
        halfThickness: 20,
        round: true,
      };
      const radius = wrapRadius(rotary);
      /** A point of the blank: along the axis, across it, up from it. */
      const on = (a: number, v: number, w: number) =>
        along === 'x' ? [a, 20 + v, w - 20] : [20 + v, a, w - 20];
      const triangles: number[] = [];
      const quad = (p: number[][]) =>
        triangles.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
      // A Ø20 rod from 20 to 80 along the axis…
      for (let i = 0; i < 72; i++) {
        const [s, t] = [i, i + 1].map((k) => (k / 72) * 2 * Math.PI);
        quad([
          on(20, 10 * Math.sin(s), 10 * Math.cos(s)),
          on(80, 10 * Math.sin(s), 10 * Math.cos(s)),
          on(80, 10 * Math.sin(t), 10 * Math.cos(t)),
          on(20, 10 * Math.sin(t), 10 * Math.cos(t)),
        ]);
      }
      // … with a fin 1 thick out to 18 from the axis, on the side a
      // quarter turn brings up, from 40 to 60.
      quad([on(40, 0, 0.5), on(60, 0, 0.5), on(60, 18, 0.5), on(40, 18, 0.5)]);
      quad([
        on(40, 0, -0.5),
        on(60, 0, -0.5),
        on(60, 18, -0.5),
        on(40, 18, -0.5),
      ]);
      quad([
        on(40, 18, -0.5),
        on(60, 18, -0.5),
        on(60, 18, 0.5),
        on(40, 18, 0.5),
      ]);
      const relief = unrolledRelief(new Float32Array(triangles), rotary, {
        angle: 0,
        depth: 15,
        around: 'floor',
        margin: 0,
        cell: 0.2,
        border: 4,
      })!;
      /** A point of the unrolled surface: along, and degrees round. */
      const at = (a: number, degrees: number) => {
        const across = 20 + (degrees * Math.PI * radius) / 180;
        return along === 'x' ? { x: a, y: across } : { x: across, y: a };
      };
      const surface = (a: number, degrees: number) => {
        const p = at(a, degrees);
        const s = relief.surface;
        return s.heights[
          Math.floor((p.y - s.minY) / s.cell) * s.nx +
            Math.floor((p.x - s.minX) / s.cell)
        ];
      };

      it('unrolls the model: how far its surface is below the wrap circle', () => {
        for (const degrees of [-170, -90, 0, 45, 130]) {
          expect(surface(30, degrees)).toBeCloseTo(-10, 1);
        }
        // The fin comes up a quarter of the way round, as a wrapped
        // design goes.
        expect(surface(50, 90)).toBeCloseTo(-2, 1);
        expect(surface(50, 80)).toBeCloseTo(-10, 1);
        // Past the model's ends nothing is carved.
        expect(surface(18, 0)).toBe(0);
        expect(relief.from).toBeCloseTo(20, 6);
        expect(relief.to).toBeCloseTo(80, 6);
      });

      it('rests a bit on the model as it is on the stock, not as unrolled', () => {
        const tip = radialDropCutter(relief, rotary, {
          bitType: 'ball-nose',
          diameter: 6,
        });
        expect(tip(at(30, 10))).toBeCloseTo(-10, 2);
        expect(tip(at(50, 90))).toBeCloseTo(-2, 2);
        expect(tip(at(10, 0))).toBe(0);
        // 15° from the fin is 5.2 mm on the unrolled surface, clear of a
        // Ø6 ball; but down at the rod that's 2.6 mm, and the fin holds
        // the ball up: where a ball of 3 touches both (see below).
        const beside = tip(at(50, 105));
        expect(beside).toBeGreaterThan(-9.75);
        expect(beside).toBeLessThan(-9.3);
        // 30° away it rests on the rod.
        expect(tip(at(50, 120))).toBeCloseTo(-10, 2);
      });

      it('gives where an end mill’s axis may go, for roughing', () => {
        const lowest = radialTipSurface(relief, rotary, {
          bitType: 'end-mill',
          diameter: 6,
        });
        const s = lowest;
        const p = at(50, 100);
        const z =
          s.heights[
            Math.floor((p.y - s.minY) / s.cell) * s.nx +
              Math.floor((p.x - s.minX) / s.cell)
          ];
        // 10° from the fin: its edge would be in the fin lower than
        // where the fin is 3 to its side, 3 / tan(10°) − … from the axis.
        expect(z).toBeGreaterThan(-7);
        let low = 0;
        for (const h of s.heights) low = Math.min(low, h);
        expect(low).toBeCloseTo(-10, 1);
      });
    });
  }
});
