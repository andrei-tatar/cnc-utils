import { arcSteps, segmentPoints } from './arcs';
import { GCodeBuilder } from './gcode-builder';
import { resolveGcodeOptions } from './gcode-options';
import {
  CURVE_TOLERANCE,
  curveTolerance,
  DEFAULT_GEOMETRY,
  usableCurveTolerance,
  useGeometry,
} from './geometry';

describe('curve tolerance', () => {
  afterEach(() => useGeometry(DEFAULT_GEOMETRY));

  it('is never used out of range, whatever is stored', () => {
    expect(usableCurveTolerance(0)).toBe(CURVE_TOLERANCE.min);
    expect(usableCurveTolerance(-1)).toBe(CURVE_TOLERANCE.min);
    expect(usableCurveTolerance(50)).toBe(CURVE_TOLERANCE.max);
    expect(usableCurveTolerance(0.05)).toBe(0.05);
    expect(usableCurveTolerance(NaN)).toBe(DEFAULT_GEOMETRY.curveTolerance);
    expect(usableCurveTolerance('0.05')).toBe(DEFAULT_GEOMETRY.curveTolerance);
    expect(resolveGcodeOptions({ curveTolerance: 0 }).curveTolerance).toBe(
      CURVE_TOLERANCE.min,
    );
    useGeometry({ curveTolerance: 0 });
    expect(curveTolerance()).toBe(CURVE_TOLERANCE.min);
  });

  it('follows curves in a finite number of pieces, even asked for 0', () => {
    for (const tolerance of [0, -1, NaN, 1e-12]) {
      const steps = arcSteps(1000, 2 * Math.PI, tolerance);
      expect(Number.isFinite(steps)).toBeTrue();
      expect(steps).toBeLessThan(20_000);
      const points = segmentPoints(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        1,
        tolerance,
      );
      expect(points.length).toBeGreaterThan(1);
      expect(points.length).toBeLessThan(1000);
    }
    // The preview of an arc with the G-code's curve precision set to 0.
    const builder = new GCodeBuilder().carveTo(-10, 0, -1).arcTo(10, 0, 1);
    const paths = builder.toPaths({ curveTolerance: 0 });
    const count = paths.reduce((n, p) => n + p.points.length, 0);
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(10_000);
  });
});
