import { DEFAULT_WOOD } from './feeds-speeds';
import { anchorPoint, Box, BoxAnchor, GcodeOptions } from './gcode-options';

/** The material being cut, and where the G-code's zero is on it. */
export type StockOptions = {
  /** Show the stock and check cuts against it. */
  enabled: boolean;
  /** Size of the stock (mm): X, Y and thickness. */
  width: number;
  height: number;
  thickness: number;
  /** Where the stock's bottom-left corner is, in design coordinates. */
  x: number;
  y: number;
  /** Z0 on the top of the stock, or on its bottom (the spoilboard). */
  zZero: 'top' | 'bottom';
  /**
   * Where X0 Y0 is in the G-code: the design's own origin, or a corner or
   * the middle of the stock.
   */
  xyZero: 'design' | BoxAnchor;
  /** The wood it is (an id in `WOODS`), for working out feeds and speeds. */
  material: string;
};

export const DEFAULT_STOCK: StockOptions = {
  enabled: false,
  width: 200,
  height: 150,
  thickness: 18,
  x: 0,
  y: 0,
  zZero: 'top',
  xyZero: 'design',
  material: DEFAULT_WOOD,
};

/** Complete stock settings from a (possibly partial) stored value. */
export function resolveStock(
  stored: Partial<StockOptions> | null | undefined,
): StockOptions {
  const merged = { ...DEFAULT_STOCK };
  for (const [key, value] of Object.entries(stored ?? {}) as Array<
    [string, unknown]
  >) {
    if (value !== null && value !== undefined && value !== '') {
      (merged as any)[key] = value;
    }
  }
  return merged;
}

/**
 * What the G-code adds to design coordinates (mm): its zero moved to the
 * stock's corner or middle, and up by the stock's thickness for Z0 at the
 * bottom. Nothing without stock.
 */
export function stockOffset(stock: StockOptions): {
  x: number;
  y: number;
  z: number;
} {
  if (!stock.enabled) {
    return { x: 0, y: 0, z: 0 };
  }
  let x = 0;
  let y = 0;
  if (stock.xyZero !== 'design') {
    const zero = anchorPoint(stock.xyZero, {
      minX: stock.x,
      minY: stock.y,
      maxX: stock.x + stock.width,
      maxY: stock.y + stock.height,
    });
    x = -zero.x;
    y = -zero.y;
  }
  return { x, y, z: stock.zZero === 'bottom' ? stock.thickness : 0 };
}

/**
 * What the G-code adds to design coordinates: `options.offset` (the
 * stock's), or, with a reference point, X and Y that put that point of the
 * cuts' bounding box (`bounds`, one per operation) where asked.
 */
export function programOffset(
  bounds: (Box | null)[],
  options: Pick<
    GcodeOptions,
    'offset' | 'referencePoint' | 'referenceX' | 'referenceY'
  >,
): { x: number; y: number; z: number } {
  const offset = options.offset ?? { x: 0, y: 0, z: 0 };
  const box = bounds.reduce<Box | null>(
    (a, b) =>
      !a || !b
        ? (a ?? b)
        : {
            minX: Math.min(a.minX, b.minX),
            minY: Math.min(a.minY, b.minY),
            maxX: Math.max(a.maxX, b.maxX),
            maxY: Math.max(a.maxY, b.maxY),
          },
    null,
  );
  if (options.referencePoint === 'none' || !box) {
    return offset;
  }
  const reference = anchorPoint(options.referencePoint, box);
  return {
    ...offset,
    x: options.referenceX - reference.x,
    y: options.referenceY - reference.y,
  };
}
