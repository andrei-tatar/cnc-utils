import {
  dropCutter,
  ReliefMap,
  reliefAt,
  reliefDepth,
  reliefSurface,
  smoothRelief,
} from './relief';
import { Heightmap, toolProfile } from './simulate';

const square = (min: number, max: number) => [
  { x: min, y: min },
  { x: max, y: min },
  { x: max, y: max },
  { x: min, y: max },
];

const filled = (width: number, height: number, value: number): ReliefMap => ({
  width,
  height,
  data: new Float32Array(width * height).fill(value),
});

describe('reliefDepth', () => {
  it('carves the lowest deepest, gamma bending the middle', () => {
    const options = { depth: 4, gamma: 1, invert: false };
    expect(reliefDepth(1, options)).toBe(0);
    expect(reliefDepth(0, options)).toBe(4);
    expect(reliefDepth(0.5, options)).toBe(2);
    expect(reliefDepth(0.5, { ...options, gamma: 2 })).toBe(1);
    expect(reliefDepth(1, { ...options, invert: true })).toBe(4);
  });
});

describe('reliefAt', () => {
  const placement = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('reads the map between cell centres, rows from the top', () => {
    // Top row 1, bottom row 0.
    const map: ReliefMap = {
      width: 1,
      height: 2,
      data: Float32Array.from([1, 0]),
    };
    expect(reliefAt(map, { x: 5, y: 7.5 }, placement)).toBeCloseTo(1, 6);
    expect(reliefAt(map, { x: 5, y: 5 }, placement)).toBeCloseTo(0.5, 6);
    expect(reliefAt(map, { x: 5, y: 2.5 }, placement)).toBeCloseTo(0, 6);
    expect(reliefAt(map, { x: 11, y: 5 }, placement)).toBeNaN();
  });

  it('leaves out cells with no height, and has none where the nearest has none', () => {
    const map: ReliefMap = {
      width: 2,
      height: 1,
      data: Float32Array.from([0.5, NaN]),
    };
    expect(reliefAt(map, { x: 4.9, y: 5 }, placement)).toBe(0.5);
    expect(reliefAt(map, { x: 5.1, y: 5 }, placement)).toBeNaN();
  });
});

describe('smoothRelief', () => {
  it('keeps an even map even and cells with no height without', () => {
    const map = filled(6, 4, 0.25);
    map.data[3] = NaN;
    const smooth = smoothRelief(map, 2);
    smooth.data.forEach((value, i) =>
      i === 3 ? expect(value).toBeNaN() : expect(value).toBeCloseTo(0.25, 6),
    );
  });

  it('spreads a step out', () => {
    const map = filled(9, 1, 0);
    for (let i = 5; i < 9; i++) map.data[i] = 1;
    const smooth = smoothRelief(map, 1);
    expect(smooth.data[0]).toBe(0);
    expect(smooth.data[8]).toBe(1);
    expect(smooth.data[4]).toBeGreaterThan(0);
    expect(smooth.data[5]).toBeLessThan(1);
  });
});

describe('reliefSurface', () => {
  const placement = { minX: 2, minY: 2, maxX: 8, maxY: 8 };
  const options = {
    placement,
    depth: 3,
    gamma: 1,
    invert: false,
    around: 'surface' as const,
  };
  const zAt = (surface: Heightmap, x: number, y: number) =>
    surface.heights[
      Math.floor((y - surface.minY) / surface.cell) * surface.nx +
        Math.floor((x - surface.minX) / surface.cell)
    ];

  it('carves the map inside the shape, the surface round it', () => {
    const surface = reliefSurface(
      filled(4, 4, 0.5),
      [square(0, 10)],
      options,
      0.5,
      1,
    );
    expect(surface.minX).toBe(-1);
    expect(surface.minY).toBe(-1);
    expect(zAt(surface, 5, 5)).toBeCloseTo(-1.5, 6);
    // In the shape, off the map: the surface…
    expect(zAt(surface, 1, 1)).toBe(0);
    // …or the floor.
    expect(
      zAt(
        reliefSurface(
          filled(4, 4, 0.5),
          [square(0, 10)],
          { ...options, around: 'floor' },
          0.5,
          1,
        ),
        1,
        1,
      ),
    ).toBe(-3);
    // Outside the shape.
    expect(zAt(surface, -0.5, 5)).toBe(0);
  });

  it('leaves holes in the shape uncut', () => {
    const surface = reliefSurface(
      filled(4, 4, 0),
      [square(0, 10), square(4, 6).reverse()],
      options,
      0.5,
      1,
    );
    expect(zAt(surface, 3, 3)).toBe(-3);
    expect(zAt(surface, 5, 5)).toBe(0);
  });
});

describe('dropCutter', () => {
  /** A map `n` × `n` cells of 0.1 mm, its heights from `z(x, y)`. */
  const surfaceOf = (n: number, z: (x: number, y: number) => number) => {
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = z((i + 0.5) * 0.1, (j + 0.5) * 0.1);
      }
    }
    const surface: Heightmap = {
      minX: 0,
      minY: 0,
      cell: 0.1,
      nx: n,
      ny: n,
      heights,
      top: 0,
      bottom: -10,
    };
    return surface;
  };
  const ball = { bitType: 'ball-nose', diameter: 2 };

  it('rests on a flat floor', () => {
    const tip = dropCutter(
      surfaceOf(60, () => -2),
      ball,
    );
    expect(tip({ x: 3, y: 3 })).toBeCloseTo(-2, 6);
  });

  it('can’t reach into a pit narrower than the ball', () => {
    // A pit 0.2 mm wide, 5 deep, in the surface.
    const tip = dropCutter(
      surfaceOf(60, (x) => (Math.abs(x - 3) < 0.1 ? -5 : 0)),
      ball,
    );
    const r = 1;
    const reach = r - Math.sqrt(r * r - 0.15 * 0.15);
    expect(tip({ x: 3, y: 3 })).toBeGreaterThan(-reach - 1e-6);
    expect(tip({ x: 3, y: 3 })).toBeLessThan(0);
  });

  it('follows a slope smoothly along a line across the cells', () => {
    // A plane falling along X: over it the ball rests the same height
    // above it wherever it is, between cell centres too (within what the
    // cells leave unknown; the nearest cell's height would be up to 0.035
    // off).
    const plane = (x: number) => -2 - 0.5 * x;
    const tip = dropCutter(
      surfaceOf(60, (x) => plane(x)),
      ball,
    );
    const above = (x: number, y: number) => tip({ x, y }) - plane(x);
    const expected = above(3.05, 3.05);
    for (let t = 0; t <= 2; t += 0.07) {
      expect(Math.abs(above(2 + t, 2 + t) - expected)).toBeLessThan(0.002);
    }
  });

  it('keeps off the outside of the loops, between cell centres too', () => {
    // The cells say floor right up to the loops' edge and past it.
    const tip = dropCutter(
      surfaceOf(60, () => -2),
      ball,
      [square(1, 5)],
    );
    expect(tip({ x: 3, y: 3 })).toBeCloseTo(-2, 6);
    // 0.5 in from the edge: the ball's side touches it.
    expect(tip({ x: 1.5, y: 3 })).toBeCloseTo(-(1 - Math.sqrt(0.75)), 6);
    expect(tip({ x: 0.5, y: 3 })).toBe(0);
  });

  it('never cuts into the surface, and touches it', () => {
    // Bumpy: waves and a step.
    const z = (x: number, y: number) =>
      -2 + Math.sin(x * 2) * Math.cos(y * 3) - (x > 3 ? 1 : 0);
    const surface = surfaceOf(60, z);
    const tools = [
      ball,
      { bitType: 'v-bit', diameter: 2, vAngle: 60, tipDiameter: 0 },
      { bitType: 'bull-nose', diameter: 2, cornerRadius: 0.4 },
      { bitType: 'end-mill', diameter: 1.2 },
    ];
    for (const tool of tools) {
      const tip = dropCutter(surface, tool);
      const profile = toolProfile(tool);
      const r = tool.diameter / 2;
      for (const p of [
        { x: 1.55, y: 1.55 },
        { x: 2.95, y: 3.05 },
        { x: 3.05, y: 2.15 },
        { x: 4.45, y: 4.45 },
      ]) {
        const at = tip(p);
        let closest = Infinity;
        for (let j = 0; j < 60; j++) {
          for (let i = 0; i < 60; i++) {
            const d = Math.hypot((i + 0.5) * 0.1 - p.x, (j + 0.5) * 0.1 - p.y);
            if (d > r) continue;
            const gap = at + profile(d) - surface.heights[j * 60 + i];
            closest = Math.min(closest, gap);
          }
        }
        // Above the surface everywhere under it, touching somewhere.
        expect(closest).toBeGreaterThan(-1e-5);
        expect(closest).toBeLessThan(1e-5);
      }
    }
  });
});
