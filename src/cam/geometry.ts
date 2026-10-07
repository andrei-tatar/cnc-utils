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
