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
  xyZero:
    'design' | `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}`;
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
};

/** Complete stock settings from a (possibly partial or older) stored value. */
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
    const [ox, oy] = stock.xyZero.split('-').map((v) => v.substring(1));
    const at = (start: number, size: number, type: string) =>
      type === 'min' ? start : type === 'max' ? start + size : start + size / 2;
    x = -at(stock.x, stock.width, ox);
    y = -at(stock.y, stock.height, oy);
  }
  return { x, y, z: stock.zZero === 'bottom' ? stock.thickness : 0 };
}
