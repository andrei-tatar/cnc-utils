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
