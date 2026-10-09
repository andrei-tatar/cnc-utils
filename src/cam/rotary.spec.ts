import { GCodeBuilder } from './gcode-builder';
import { DEFAULT_GCODE_OPTIONS, GcodeOptions } from './gcode-options';
import {
  isTurned,
  operationPointOnBlank,
  Rotary,
  rotaryClearance,
  rotaryOf,
  rotaryShift,
  sideUp,
  wrappedPointOnBlank,
} from './rotary';
import {
  DEFAULT_STOCK,
  resolveStock,
  StockOptions,
  stockOffset,
} from './stock';

/** 100 long, 40 across, 60 thick, on an axis along `along`. */
function stock(along: 'x' | 'y'): StockOptions {
  return {
    ...DEFAULT_STOCK,
    enabled: true,
    mount: 'rotary',
    rotaryAlong: along,
    x: 10,
    y: 20,
    width: along === 'x' ? 100 : 40,
    height: along === 'x' ? 40 : 100,
    thickness: 60,
  };
}

function expectPoint(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

describe('rotary axis', () => {
  it('is only there for stock held on one', () => {
    expect(rotaryOf({ ...stock('x'), mount: 'table' })).toBeNull();
    expect(rotaryOf({ ...stock('x'), enabled: false })).toBeNull();
    expect(rotaryOf(stock('x'))).toEqual({
      along: 'x',
      across: 40,
      halfWidth: 20,
      halfThickness: 30,
      round: false,
    });
    expect(rotaryOf(stock('y'))).toEqual({
      along: 'y',
      across: 30,
      halfWidth: 20,
      halfThickness: 30,
      round: false,
    });
  });

  it('raises Z by how much higher the top is as turned', () => {
    const rotary = rotaryOf(stock('x'))!;
    expect(rotaryShift(rotary, 0)).toBe(0);
    expect(rotaryShift(rotary, 360)).toBe(0);
    expect(rotaryShift(rotary, 90)).toBeCloseTo(-10, 9);
    expect(rotaryShift(rotary, 180)).toBeCloseTo(0, 9);
    expect(rotaryShift(rotary, -90)).toBeCloseTo(-10, 9);
    // On its edge, a corner is the top.
    expect(rotaryShift(rotary, 45)).toBeCloseTo(50 * Math.SQRT1_2 - 30, 9);
    expect(rotaryClearance(rotary)).toBeCloseTo(Math.hypot(20, 30) - 30, 9);
    expect(isTurned(720)).toBeFalse();
    expect(isTurned(-90)).toBeTrue();
  });

  it('puts the cuts on the side the turn brings up', () => {
    const alongX = rotaryOf(stock('x'))!;
    // The middle of the top at 90°, 5 deep: 5 in from the +Y side, half
    // way down.
    expectPoint(operationPointOnBlank(alongX, 90, { x: 50, y: 40, z: -5 }), {
      x: 50,
      y: 55,
      z: -30,
    });
    expect(sideUp('x', 90)).toBe('the +Y side up');
    // Upside down: the bottom, and Y the other way round.
    expectPoint(operationPointOnBlank(alongX, 180, { x: 50, y: 45, z: -1 }), {
      x: 50,
      y: 35,
      z: -59,
    });
    expect(sideUp('x', 180)).toBe('the bottom up');

    const alongY = rotaryOf(stock('y'))!;
    expectPoint(operationPointOnBlank(alongY, 90, { x: 30, y: 50, z: -5 }), {
      x: 15,
      y: 50,
      z: -30,
    });
    expect(sideUp('y', 90)).toBe('the −X side up');
    expect(sideUp('y', -90)).toBe('the +X side up');
    expect(sideUp('y', 30)).toBeNull();
  });

  it('takes a cylinder as round: the same top whichever way it’s turned', () => {
    const stock = resolveStock({
      enabled: true,
      mount: 'rotary',
      rotaryAlong: 'y',
      shape: 'cylinder',
      diameter: 40,
      width: 999,
      height: 500,
      thickness: 999,
    });
    // Its box: as wide and thick as it's round, as long as asked.
    expect([stock.width, stock.height, stock.thickness]).toEqual([40, 500, 40]);
    const rotary = rotaryOf(stock)!;
    expect(rotary.round).toBeTrue();
    for (const angle of [0, 30, 45, 90, 200]) {
      expect(rotaryShift(rotary, angle)).toBe(0);
    }
    expect(rotaryClearance(rotary)).toBe(0);
    // Only on a rotary axis.
    expect(resolveStock({ shape: 'cylinder', mount: 'table' }).shape).toBe(
      'box',
    );
  });

  it('puts Z0 on the axis when asked', () => {
    expect(stockOffset({ ...stock('x'), zZero: 'axis' }).z).toBe(30);
    expect(stockOffset({ ...stock('x'), zZero: 'top' }).z).toBe(0);
  });
});

describe('G-code with the stock on a rotary axis', () => {
  const rotary: Rotary = rotaryOf(stock('x'))!;
  const options: GcodeOptions = {
    ...DEFAULT_GCODE_OPTIONS,
    header: false,
    spindle: false,
    toolChange: 'none',
    rotary,
  };
  const cut = (angle: number) =>
    new GCodeBuilder()
      .sourceOperationId(`at ${angle}`)
      .rotate(angle)
      .travelTo(50, 40)
      .plunge(-1)
      .carveTo(60, 40)
      .goToSafeHeight();
  const job = () =>
    GCodeBuilder.concatAll([cut(0), cut(90)])
      .goToSafeHeight()
      .stopProgram();
  const safe = Math.round((5 + rotaryClearance(rotary)) * 1000) / 1000;

  it('turns the axis at safe height, clearing the corners, and back at the end', () => {
    const lines = job()
      .build(options)
      .split('\n')
      .filter((line) => !line.startsWith(';'));
    expect(lines).toEqual([
      `G0 Z${safe}`,
      'G0 A0',
      'G0 X50 Y40',
      'G1 Z-1 F300',
      'G1 X60 F1200',
      `G0 Z${safe}`,
      'G0 A90',
      'G0 X50',
      // The top at 90° is 10 lower.
      'G1 Z-11 F300',
      'G1 X60 F1200',
      `G0 Z${safe}`,
      'G0 A0',
      'M30',
    ]);
  });

  it('names the axis and turns it the other way when asked', () => {
    const gcode = job().build({
      ...options,
      rotaryAxis: 'B',
      rotaryReversed: true,
    });
    expect(gcode).toContain('G0 B-90');
    expect(gcode).toContain('G0 B0');
    expect(gcode).not.toContain('A');
  });

  it('ignores turns without a rotary axis', () => {
    const gcode = job().build({ ...options, rotary: null });
    expect(gcode).not.toMatch(/A-?\d/);
    expect(gcode).toContain('G1 Z-1');
    expect(gcode).not.toContain('Z-11');
  });

  it('gives the preview the cuts in their own frame, saying how far turned', () => {
    const paths = job().toPaths(options);
    const turned = paths.filter((p) => p.type === 'carve' && p.rotation);
    expect(turned.length).toBe(1);
    expect(turned[0].rotation).toBe(90);
    // From safe height (as high above this top as it is above the top at
    // 0°, plus how much lower this top is), down to the cut.
    expect(turned[0].points.map((p) => p.z)).toEqual([safe + 10, -1, -1]);
    const flat = paths.filter((p) => p.type === 'carve' && !p.rotation);
    expect(flat[0].points.map((p) => p.z)).toEqual([safe, -1, -1]);
    // Turning is drawn as a travel round the axis, on the blank at 0°.
    const turning = paths.find(
      (p) =>
        p.type === 'travel' &&
        p.sourceOperationId === 'at 90' &&
        p.rotation === undefined &&
        p.points.length > 2,
    )!;
    const last = turning.points[turning.points.length - 1];
    expect(Math.hypot(last.y - 40, last.z + 30)).toBeCloseTo(30 + safe, 2);
  });

  it('counts the time turning takes', () => {
    const without = job().estimateTime({ ...options, rotary: null });
    const turning = job().estimateTime(options);
    expect(turning.total).toBeGreaterThan(without.total);
  });
});

describe('G-code wrapped round a round stock', () => {
  // Ø40, 100 long, along X: across at Y20, the axis 20 below the top.
  const rotary: Rotary = rotaryOf(
    resolveStock({
      enabled: true,
      mount: 'rotary',
      rotaryAlong: 'x',
      shape: 'cylinder',
      diameter: 40,
      width: 100,
      x: 0,
      y: 0,
    }),
  )!;
  const options: GcodeOptions = {
    ...DEFAULT_GCODE_OPTIONS,
    header: false,
    spindle: false,
    toolChange: 'none',
    rotary,
  };
  // A quarter of the way round, 2 deep: the unrolled surface's quarter.
  const quarter = (Math.PI * 20) / 2;
  const job = () =>
    new GCodeBuilder()
      .sourceOperationId('wrapped')
      .rotate(0, true)
      .travelTo(10, 20)
      .plunge(-2)
      .carveTo(10, 20 + quarter)
      .goToSafeHeight()
      .stopProgram();
  const cuts = (gcode: string) =>
    gcode.split('\n').filter((l) => !l.startsWith(';'));

  it('turns the axis as it goes, the bit over the axis', () => {
    const lines = cuts(job().build(options));
    expect(lines).toContain('G0 X10 Y20');
    // 90° round, at the feed along the surface where the bit is (2 deep:
    // radius 18), written in the controller's degrees-as-mm.
    const speed = (1200 * 90) / ((18 * Math.PI) / 2);
    expect(lines).toContain(`G1 A90 F${Math.round(speed * 1000) / 1000}`);
    expect(lines.some((l) => /Y5\d/.test(l))).toBeFalse();
  });

  it('or in inverse time, each move’s F the times a minute it takes', () => {
    const lines = cuts(job().build({ ...options, rotaryFeed: 'inverse-time' }));
    const g93 = lines.indexOf('G93');
    const g94 = lines.indexOf('G94');
    expect(g93).toBeGreaterThan(-1);
    expect(g94).toBeGreaterThan(g93);
    const along = (18 * Math.PI) / 2;
    expect(lines).toContain(
      `G1 A90 F${Math.round((1200 / along) * 1000) / 1000}`,
    );
  });

  it('gives the preview the cut unrolled, in points along it', () => {
    const cut = job()
      .toPaths(options)
      .find((p) => p.type === 'carve' && p.points.length > 3)!;
    expect(cut.wrapped).toBeTrue();
    expect(cut.rotation).toBe(0);
    const last = cut.points[cut.points.length - 1];
    expect(last.x).toBeCloseTo(10, 6);
    expect(last.y).toBeCloseTo(20 + quarter, 2);
    expect(last.z).toBeCloseTo(-2, 6);
    // Wrapped on the blank: a quarter turn round brings it to the +Y side.
    const onBlank = wrappedPointOnBlank(rotary, 0, last);
    expect(onBlank.y).toBeCloseTo(20 + 18, 2);
    expect(onBlank.z).toBeCloseTo(-20, 2);
  });

  it('turns the axis the short way between cuts, not the whole way back', () => {
    // Two spirals, each three turns long (−540° to 540°), side by side.
    const at = (degrees: number) => 20 + (degrees * Math.PI * 20) / 180;
    const lines = cuts(
      new GCodeBuilder()
        .rotate(0, true)
        .travelTo(10, at(-540))
        .plunge(-1)
        .carveTo(10, at(540))
        .goToSafeHeight()
        .travelTo(20, at(-540))
        .plunge(-1)
        .carveTo(20, at(540))
        .goToSafeHeight()
        .stopProgram()
        .build(options),
    );
    const angles = lines.map((l) => /A(-?[\d.]+)/.exec(l)?.[1]);
    // To the first spiral's start: half a turn, not one and a half.
    const first = lines.findIndex((l) => l.startsWith('G0 X10'));
    expect(Math.abs(+angles[first]!)).toBe(180);
    // Each cut goes the whole three turns.
    const cutsA = lines.filter((l) => l.startsWith('G1') && /A/.test(l));
    expect(cutsA.length).toBe(2);
    // From the first spiral's end to the second's start: no turning at all.
    const second = lines.findIndex((l) => l.startsWith('G0 X20'));
    expect(lines[second]).toBe('G0 X20');
    // Back to exactly 0° at the end.
    expect(lines[lines.length - 2]).toBe('G0 A0');
    // And the preview's travel between them is no spiral.
    const travel = new GCodeBuilder()
      .rotate(0, true)
      .travelTo(10, at(-540))
      .plunge(-1)
      .carveTo(10, at(540))
      .goToSafeHeight()
      .travelTo(20, at(-540))
      .toPaths(options)
      .filter((p) => p.type === 'travel' && p.wrapped)
      .pop()!;
    // (up and along X: on the stock, never round it).
    const placed = travel.points.map((p) => wrappedPointOnBlank(rotary, 0, p));
    const ys = placed.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
  });

  it('counts the time going round', () => {
    const time = job().estimateTime(options);
    // About 28 mm cut at 1200 mm/min, at least.
    expect(time.total).toBeGreaterThan(((18 * Math.PI) / 2 / 1200) * 60);
  });
});

describe('wrapping round a round stock along Y', () => {
  const rotary: Rotary = rotaryOf(
    resolveStock({
      enabled: true,
      mount: 'rotary',
      rotaryAlong: 'y',
      shape: 'cylinder',
      diameter: 40,
      height: 100,
      x: 0,
      y: 0,
    }),
  )!;

  it('keeps a design reading as drawn: +X in the drawing is +X on the stock', () => {
    // A little way +X of the axis line, on the surface.
    const p = wrappedPointOnBlank(rotary, 0, { x: 25, y: 50, z: 0 });
    expect(p.x).toBeGreaterThan(20);
    // A quarter of the way round: on the +X side.
    const q = wrappedPointOnBlank(rotary, 0, {
      x: 20 + (Math.PI * 20) / 2,
      y: 50,
      z: 0,
    });
    expect(q.x).toBeCloseTo(40, 6);
    expect(q.z).toBeCloseTo(-20, 6);
  });

  it('turns the axis the way that brings that side up', () => {
    const gcode = new GCodeBuilder()
      .rotate(0, true)
      .travelTo(20 + (Math.PI * 20) / 2, 50)
      .build({ ...DEFAULT_GCODE_OPTIONS, rotary });
    // −90° brings the +X side up (along Y, +90° brings −X up).
    expect(gcode).toContain('G0 X20 Y50 A-90');
  });
});
