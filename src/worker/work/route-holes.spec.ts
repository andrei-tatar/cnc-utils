import { CamShape } from '../../cam/types';
import { boreHoles, routeHelix } from './route-helix';
import { drillPositions, routeDrill } from './route-drill';
import { pointLength } from '../../app/model-editor/operations/operation-drill';

const points: CamShape[] = [
  {
    sourceShapeId: 's',
    polygons: [
      { points: [{ x: 30, y: 0 }], close: false },
      { points: [{ x: 10, y: 0 }], close: false },
    ],
  },
];

function circle(cx: number, cy: number, r: number, n = 64) {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));
}

const drillDefaults = {
  drillAt: 'points' as const,
  startDepth: 0,
  depth: 6,
  pointLength: 0,
  peck: 0,
  chipBreak: false,
  dwell: 0,
  retractHeight: 1,
  cycles: false,
};

describe('drilling', () => {
  it('drills the nearest hole first', () => {
    expect(drillPositions(points, 'points')).toEqual([
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('finds outline centres, not holes’', () => {
    const shape: CamShape[] = [
      {
        sourceShapeId: 's',
        polygons: [
          { points: circle(5, 5, 4), close: true },
          { points: circle(5, 5, 1), close: true },
        ],
      },
    ];
    const [center, ...rest] = drillPositions(shape, 'centers');
    expect(rest.length).toBe(0);
    expect(center.x).toBeCloseTo(5, 6);
  });

  it('pecks down, out between pecks', async () => {
    const gcode = (
      await routeDrill(points, { ...drillDefaults, peck: 2 })
    ).build({ header: false, arcs: false });
    const plunges = gcode.match(/^G1 Z-\d/gm) ?? [];
    expect(plunges.length).toBe(6); // 3 pecks × 2 holes
    expect(gcode).toContain('G0 Z1');
    expect(gcode).toContain('G1 Z-6');
  });

  it('writes canned cycles, cancelled after the last hole', async () => {
    const gcode = (
      await routeDrill(points, { ...drillDefaults, peck: 2, cycles: true })
    ).build({ header: false });
    const lines = gcode.split('\n');
    expect(lines).toContain('G98 G83 X10 Y0 Z-6 R1 Q2 F300');
    expect(lines).toContain('G83 X30 Y0 Z-6 R1 Q2');
    expect(lines.indexOf('G80')).toBeGreaterThan(
      lines.indexOf('G83 X30 Y0 Z-6 R1 Q2'),
    );
  });

  it('previews canned cycles as the moves they make', async () => {
    const paths = (
      await routeDrill(points, { ...drillDefaults, cycles: true })
    ).toPaths();
    const deepest = Math.min(...paths.flatMap((p) => p.points.map((q) => q.z)));
    expect(deepest).toBe(-6);
  });

  it('knows how long a drill’s point is', () => {
    expect(pointLength(6, 118)).toBeCloseTo(
      3 / Math.tan((59 * Math.PI) / 180),
      9,
    );
    expect(pointLength(6, 180)).toBe(0);
  });
});

describe('helical boring', () => {
  const hole: CamShape[] = [
    {
      sourceShapeId: 's',
      polygons: [{ points: circle(0, 0, 10), close: true }],
    },
  ];
  const options = {
    toolSize: 6,
    startDepth: 0,
    depth: 3,
    pitch: 1,
    direction: 'climb' as const,
    leaveStock: 0,
    clearMiddle: false,
    toolEngagement: 0.4,
  };

  it('measures round holes', () => {
    const [bore] = boreHoles(hole);
    expect(bore.radius).toBeCloseTo(10, 1);
  });

  it('spirals down at the radius that cuts the hole', async () => {
    const paths = (await routeHelix(hole, options)).toPaths();
    const carve = paths
      .filter((p) => p.type === 'carve')
      .flatMap((p) => p.points);
    const radii = carve.filter((p) => p.z < 0).map((p) => Math.hypot(p.x, p.y));
    for (const r of radii) {
      expect(r).toBeCloseTo(7, 0);
    }
    expect(Math.min(...carve.map((p) => p.z))).toBeCloseTo(-3, 9);
  });

  it('turns counter-clockwise when climb milling', async () => {
    const paths = (await routeHelix(hole, options)).toPaths();
    const carve = paths
      .filter((p) => p.type === 'carve')
      .flatMap((p) => p.points);
    const [a, b] = carve.filter((p) => p.z < 0);
    expect(a.x * b.y - a.y * b.x).toBeGreaterThan(0);
  });

  it('bores rings out from the middle for wide holes', async () => {
    const paths = (
      await routeHelix(hole, { ...options, clearMiddle: true })
    ).toPaths();
    const rings = new Set(
      paths
        .filter((p) => p.type === 'carve')
        .flatMap((p) => p.points)
        .filter((p) => p.z < -2.99)
        .map((p) => Math.round(Math.hypot(p.x, p.y) * 10) / 10),
    );
    expect(rings.size).toBeGreaterThan(1);
  });

  it('writes the helix as helical arcs', async () => {
    const gcode = (await routeHelix(hole, options)).build({ header: false });
    const arcs = gcode.split('\n').filter((l) => /^G3 /.test(l));
    // 3 turns down and 1 round the bottom, under 270° an arc.
    expect(arcs.length).toBeGreaterThanOrEqual(4);
    expect(arcs.length).toBeLessThan(12);
    expect(arcs.some((l) => / Z-/.test(l))).toBeTrue();
    expect(gcode.match(/^G1 X/gm)?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it('leaves out shapes that aren’t round', () => {
    const square: CamShape[] = [
      {
        sourceShapeId: 's',
        polygons: [
          {
            close: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ];
    expect(boreHoles(square)).toEqual([]);
  });

  it('never plunges into the middle of a wide hole', async () => {
    const wide: CamShape[] = [
      {
        sourceShapeId: 's',
        polygons: [{ points: circle(0, 0, 7), close: true }],
      },
    ];
    const gcode = (
      await routeHelix(wide, {
        ...options,
        clearMiddle: true,
        toolEngagement: 1,
      })
    ).build({ header: false });
    expect(gcode).not.toMatch(/^G0 X0 Y0$/m);
    expect(gcode).not.toMatch(/^G1 Z-3/m);
  });
});

describe('drill cycle preview', () => {
  it('shows the pecks', async () => {
    const paths = (
      await routeDrill([points[0]], {
        ...drillDefaults,
        peck: 2,
        cycles: true,
      })
    ).toPaths();
    const plunges = paths.filter(
      (p) => p.type === 'carve' && p.points.some((q) => q.z < 0),
    );
    // Pecks count from R (1 mm up): 7 mm in 2 mm pecks, 4 per hole.
    expect(plunges.length).toBe(8);
  });
});
