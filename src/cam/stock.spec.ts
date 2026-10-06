import { GCodeBuilder } from './gcode-builder';
import { DEFAULT_STOCK, stockOffset } from './stock';

describe('stockOffset', () => {
  const stock = {
    ...DEFAULT_STOCK,
    enabled: true,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    thickness: 12,
  };

  it('is nothing without stock', () => {
    expect(stockOffset({ ...stock, enabled: false })).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('moves the zero to the stock', () => {
    expect(stockOffset({ ...stock, xyZero: 'xmin-ymin' })).toEqual({
      x: -10,
      y: -20,
      z: 0,
    });
    expect(
      stockOffset({ ...stock, xyZero: 'xcenter-ycenter', zZero: 'bottom' }),
    ).toEqual({ x: -60, y: -45, z: 12 });
  });

  it('shifts the written G-code, not the preview', () => {
    const b = new GCodeBuilder()
      .goToSafeHeight()
      .travelTo(10, 20)
      .plunge(-1)
      .carveTo(15, 20)
      .stopProgram();
    const offset = { x: -10, y: -20, z: 12 };
    const lines = b.build({ header: false, offset }).split('\n');
    expect(lines).toContain('G0 Z22');
    expect(lines).toContain('G0 X0 Y0');
    expect(lines).toContain('G1 Z11 F300');
    expect(lines).toContain('G1 X5 F1200');
    const preview = b.toPaths({});
    expect(preview.some((p) => p.points.some((q) => q.x === 10))).toBeTrue();
  });

  it('returns home to the G-code’s own zero', () => {
    const lines = new GCodeBuilder()
      .travelTo(50, 50)
      .stopProgram()
      .build({ header: false, returnHome: true, offset: { x: 5, y: 5, z: 0 } })
      .split('\n');
    expect(lines[lines.length - 2]).toBe('G0 X0 Y0');
  });
});

describe('estimateTime', () => {
  it('times cuts at their feed and rapids at the rapid rate', () => {
    const b = new GCodeBuilder()
      .sourceOperationId('a')
      .travelTo(0, 0)
      .plunge(0)
      .carveTo(1200, 0)
      .travelTo(1200, 3000);
    const time = b.estimateTime({
      carveFeedRate: 1200,
      rapidRate: 3000,
      safetyHeight: 10,
    });
    // 1200 mm at 1200 mm/min, then 3000 mm at 3000 mm/min.
    expect(time.total).toBeCloseTo(120, 6);
    expect(time.byOperation.get('a')).toBeCloseTo(120, 6);
  });

  it('counts dwells', () => {
    const time = new GCodeBuilder().dwell(2.5).estimateTime({});
    expect(time.total).toBeCloseTo(2.5, 6);
  });
});
