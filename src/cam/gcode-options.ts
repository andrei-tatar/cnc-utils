import { usableCurveTolerance } from './geometry';

/** A corner, the middle of a side, or the middle of a box. */
export type BoxAnchor =
  `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}`;

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Where `anchor` is on `box`. */
export function anchorPoint(
  anchor: BoxAnchor,
  box: Box,
): { x: number; y: number } {
  const [ax, ay] = anchor.split('-').map((v) => v.substring(1));
  const at = (min: number, max: number, type: string) =>
    type === 'min' ? min : type === 'max' ? max : (min + max) / 2;
  return { x: at(box.minX, box.maxX, ax), y: at(box.minY, box.maxY, ay) };
}

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
   * Within each operation, cut the shapes in the order (and from the
   * points) that keeps the travel between them short, instead of as they
   * come. Feeds routing, not the writing out.
   */
  optimizeTravel: boolean;
  /**
   * Max distance (mm) between a curve and what stands in for it: arcs
   * fitted to SVG and text curves (Béziers, ellipses), lines for arcs where
   * only points will do (the preview, a non-uniform scale).
   */
  curveTolerance: number;
  /**
   * Decimal places of the geometry's precision: the smallest distance told
   * apart (see `precision()` in geometry.ts).
   */
  geometryDecimals: number;
  /** Rapid (G0) speed, mm/min: only for estimating how long a job takes. */
  rapidRate: number;
  /**
   * Move the G-code so this point of the cuts' bounding box (where the
   * tool's centre goes) lands on `referenceX`, `referenceY`; `none` leaves
   * it where the design (or the stock's X0 Y0) puts it. Overrides the
   * stock's X0 Y0.
   */
  referencePoint: 'none' | BoxAnchor;
  referenceX: number;
  referenceY: number;
  /**
   * Added to every coordinate written (not to the preview): moves the
   * G-code's zero onto the stock. Set from the stock settings.
   */
  offset?: { x: number; y: number; z: number };
};

export const DEFAULT_GCODE_OPTIONS: GcodeOptions = {
  safetyHeight: 5,
  carveFeedRate: 1200,
  plungeFeedRate: 300,
  header: true,
  toolChange: 'm6',
  skipSingleToolChange: false,
  spindle: true,
  spindleSpeed: 12000,
  spindleDelay: 3,
  returnHome: false,
  decimals: 3,
  arcs: true,
  optimizeTravel: true,
  curveTolerance: 0.01,
  geometryDecimals: 2,
  rapidRate: 3000,
  referencePoint: 'none',
  referenceX: 0,
  referenceY: 0,
};

/** Complete options from a (possibly partial) stored value. */
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
  // A field left out of range (0, say) is still stored: never use it so.
  merged.curveTolerance = usableCurveTolerance(merged.curveTolerance);
  return merged;
}
