/**
 * How precisely shapes are turned into polygons and processed (set in the
 * G-code section).
 */
export type GeometrySettings = {
  /** Max distance (mm) between a curve and the polygon that stands in for it. */
  curveTolerance: number;
  /** Decimal places Clipper works to (offsets, booleans): 2 = 0.01 mm. */
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

/** Max distance (mm) between a curve and its polygon. */
export function curveTolerance(): number {
  return current.curveTolerance;
}

/** Decimal places for Clipper. */
export function decimals(): number {
  return current.decimals;
}

/** The smallest distance (mm) the geometry tells apart: 10^-decimals. */
export function precision(): number {
  return 10 ** -current.decimals;
}
