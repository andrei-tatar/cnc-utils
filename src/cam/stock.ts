import { polygonsBounds } from './arcs';
import { DEFAULT_WOOD } from './feeds-speeds';
import { anchorPoint, BoxAnchor } from './gcode-options';
import { CamPolygon } from './types';

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
  /**
   * Lying on the table, or held on a rotary axis (centred on it, along X or
   * Y: `rotaryAlong`), so operations can turn it first (see `rotary.ts`).
   */
  mount: 'table' | 'rotary';
  rotaryAlong: 'x' | 'y';
  /**
   * On a rotary axis, a box or a cylinder (a round blank) of `diameter`,
   * as long as the box is along the axis. `resolveStock` sets a cylinder's
   * size across the axis and its thickness to its diameter, so its box is
   * the box round it.
   */
  shape: 'box' | 'cylinder';
  diameter: number;
  /**
   * Z0 on the top of the stock, on its bottom (the spoilboard), or on the
   * rotary axis. The bottom on a rotary axis, or the axis on the table,
   * read as the other.
   */
  zZero: 'top' | 'bottom' | 'axis';
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
  mount: 'table',
  rotaryAlong: 'x',
  shape: 'box',
  diameter: 50,
  zZero: 'top',
  xyZero: 'design',
  material: DEFAULT_WOOD,
};

/**
 * The stock's corner and size round everything cut: each entry's polygons
 * grown by its `margin` (the tool's diameter: an outside profile's tool
 * reaches that far past the line), out to whole millimetres. Null when
 * there's nothing to go round.
 */
export function stockAround(
  cuts: { polygons: CamPolygon[]; margin: number }[],
): Pick<StockOptions, 'x' | 'y' | 'width' | 'height'> | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { polygons, margin } of cuts) {
    const box = polygonsBounds(polygons);
    if (!(box.minX <= box.maxX && box.minY <= box.maxY)) continue;
    minX = Math.min(minX, box.minX - margin);
    minY = Math.min(minY, box.minY - margin);
    maxX = Math.max(maxX, box.maxX + margin);
    maxY = Math.max(maxY, box.maxY + margin);
  }
  if (!(minX <= maxX && minY <= maxY)) {
    return null;
  }
  // Whole millimetres, but not one more for rounding noise (-1e-15).
  const x = Math.floor(minX + 1e-6);
  const y = Math.floor(minY + 1e-6);
  return {
    x,
    y,
    width: Math.ceil(maxX - 1e-6) - x,
    height: Math.ceil(maxY - 1e-6) - y,
  };
}

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
  // Round only on a rotary axis; across it, a cylinder is its diameter.
  if (merged.mount !== 'rotary') {
    merged.shape = 'box';
  } else if (merged.shape === 'cylinder') {
    merged.thickness = merged.diameter;
    if (merged.rotaryAlong === 'y') merged.width = merged.diameter;
    else merged.height = merged.diameter;
  }
  return merged;
}

/**
 * What the G-code adds to design coordinates (mm): its zero moved to the
 * stock's corner or middle, and up by the stock's thickness for Z0 at the
 * bottom (by half of it for Z0 on the rotary axis). Nothing without stock.
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
  const z =
    stock.zZero === 'top'
      ? 0
      : stock.mount === 'rotary'
        ? stock.thickness / 2
        : stock.thickness;
  return { x, y, z };
}
