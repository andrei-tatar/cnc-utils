/**
 * How precisely shapes are turned into polygons and processed (set in the
 * G-code section).
 */
export type GeometrySettings = {
  /**
   * Max distance (mm) between a curve and what stands in for it (arcs fitted
   * to Béziers, lines for arcs where only points will do).
   */
  curveTolerance: number;
  /**
   * Decimal places of the precision: 2 = 0.01 mm. The geometry kernel works
   * exactly; this is how finely routers search along cuts and tell points
   * apart.
   */
  decimals: number;
};

export const DEFAULT_GEOMETRY: GeometrySettings = {
  curveTolerance: 0.01,
  decimals: 2,
};

/**
 * The curve tolerances (mm) that can be used: finer would take ever more
 * pieces to follow a curve (none at 0: it never gets there).
 */
export const CURVE_TOLERANCE = { min: 0.001, max: 1 };

/**
 * A curve tolerance that can be used: `value` kept within CURVE_TOLERANCE,
 * or the default when it isn't a number.
 */
export function usableCurveTolerance(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_GEOMETRY.curveTolerance;
  }
  return Math.min(CURVE_TOLERANCE.max, Math.max(CURVE_TOLERANCE.min, value));
}

let current = DEFAULT_GEOMETRY;

/**
 * Use `settings` for the geometry that follows. Work functions that take
 * them call this first; each worker runs one job at a time, so they stay in
 * effect for the whole job. Without settings (e.g. one work function calling
 * another), the current ones stay.
 */
export function useGeometry(settings?: Partial<GeometrySettings>) {
  if (settings) {
    current = { ...DEFAULT_GEOMETRY, ...settings };
    current.curveTolerance = usableCurveTolerance(current.curveTolerance);
  }
}

/** Max distance (mm) between a curve and what stands in for it. */
export function curveTolerance(): number {
  return current.curveTolerance;
}

/** Decimal places of the precision. */
export function decimals(): number {
  return current.decimals;
}

/** The smallest distance (mm) the geometry tells apart: 10^-decimals. */
export function precision(): number {
  return 10 ** -current.decimals;
}
