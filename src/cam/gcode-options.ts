/** Project-wide settings for the generated G-code. */
export type GcodeOptions = {
  /** Height for rapid moves and tool changes, in mm above the stock. */
  safetyHeight: number;
  /** Default cutting feed rate (mm/min), for tools without their own. */
  carveFeedRate: number;
  /** Default plunge feed rate (mm/min), for tools without their own. */
  plungeFeedRate: number;
  /** Start with G90 G21 G17 (absolute, millimetres, XY plane). */
  header: boolean;
  /**
   * How to change tools between operations:
   * - `m6`: `T<n> M6` (automatic or controller-guided tool change)
   * - `pause`: `M0` with a comment, to swap the tool by hand (plain GRBL
   *   doesn't support M6)
   * - `none`: no tool change commands at all
   */
  toolChange: 'm6' | 'pause' | 'none';
  /** Skip tool change commands when every operation uses the same tool. */
  skipSingleToolChange: boolean;
  /** Start the spindle (M3) before cutting and stop it (M5) when done. */
  spindle: boolean;
  /** Spindle speed, in RPM. */
  spindleSpeed: number;
  /** Wait after starting the spindle, in seconds (G4). */
  spindleDelay: number;
  /** Rapid back to X0 Y0 at the end of the program. */
  returnHome: boolean;
  /** Decimal places for coordinates. */
  decimals: number;
  /** Write cuts that follow a circle as arcs (G2 / G3) instead of many lines. */
  arcs: boolean;
  /**
   * Max distance (mm) between a curve (circle, arc, SVG, text) and the
   * polygon that stands in for it.
   */
  curveTolerance: number;
  /** Decimal places for geometry (Clipper offsets and booleans). */
  geometryDecimals: number;
  /** Rapid (G0) speed, mm/min: only for estimating how long a job takes. */
  rapidRate: number;
  /**
   * Added to every coordinate written (not to the preview): moves the
   * G-code's zero onto the stock. Set from the stock settings.
   */
  offset?: { x: number; y: number; z: number };
};

export const DEFAULT_GCODE_OPTIONS: GcodeOptions = {
  safetyHeight: 10,
  carveFeedRate: 1200,
  plungeFeedRate: 300,
  header: true,
  toolChange: 'm6',
  skipSingleToolChange: true,
  spindle: false,
  spindleSpeed: 12000,
  spindleDelay: 3,
  returnHome: false,
  decimals: 2,
  arcs: true,
  curveTolerance: 0.01,
  geometryDecimals: 2,
  rapidRate: 3000,
};

/** Complete options from a (possibly partial or older) stored value. */
export function resolveGcodeOptions(
  stored: Partial<GcodeOptions> | null | undefined,
): GcodeOptions {
  const merged = { ...DEFAULT_GCODE_OPTIONS };
  // Stored values come from user input and old files: check them loosely.
  for (const [key, value] of Object.entries(stored ?? {}) as Array<
    [string, unknown]
  >) {
    // Keep defaults for cleared fields (null / empty) instead of breaking.
    if (value !== null && value !== undefined && value !== '') {
      (merged as any)[key] = value;
    }
  }
  return merged;
}
