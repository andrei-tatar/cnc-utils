/** Project-wide settings for the generated G-code. */
export type GcodeOptions = {
  /** Height for rapid moves and tool changes, in mm above the stock. */
  safetyHeight: number;
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
};

export const DEFAULT_GCODE_OPTIONS: GcodeOptions = {
  safetyHeight: 10,
  header: true,
  toolChange: 'm6',
  skipSingleToolChange: true,
  spindle: false,
  spindleSpeed: 12000,
  spindleDelay: 3,
  returnHome: false,
  decimals: 2,
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
