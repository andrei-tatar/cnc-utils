import { reversePolygon, transformPolygon } from '../../cam/arcs';
import { StockOptions } from '../../cam/stock';
import { CamPoint, CamShape } from '../../cam/types';

/**
 * How an operation on the back of a two-sided job is cut: mirrored across
 * the line through the board's middle it's turned over along (`along`, at
 * `across` — Y for one along X, X along Y).
 */
export type FlipFrame = { along: 'x' | 'y'; across: number };

/** The flip frame of a board turned over along `along`. */
export function flipFrame(stock: StockOptions, along: 'x' | 'y'): FlipFrame {
  return {
    along,
    across:
      along === 'x' ? stock.y + stock.height / 2 : stock.x + stock.width / 2,
  };
}

/** `p` mirrored across the flip line: where it is with the back up. */
export function flipPoint<T extends CamPoint>(p: T, frame: FlipFrame): T {
  return frame.along === 'x'
    ? { ...p, y: 2 * frame.across - p.y }
    : { ...p, x: 2 * frame.across - p.x };
}

/**
 * Shapes drawn on the board, seen from the top, as they are with its back
 * up: mirrored across the flip line, tabs too. Closed loops are reversed
 * as well, so they keep going the way round they went (outlines and holes
 * stay what they were).
 */
export function flipShapes(shapes: CamShape[], frame: FlipFrame): CamShape[] {
  const m: [number, number, number, number, number, number] =
    frame.along === 'x'
      ? [1, 0, 0, -1, 0, 2 * frame.across]
      : [-1, 0, 0, 1, 2 * frame.across, 0];
  return shapes.map((shape) => {
    const flipped: CamShape = {
      sourceShapeId: shape.sourceShapeId,
      polygons: shape.polygons.map((polygon) => {
        const mirrored = transformPolygon(polygon, m);
        return polygon.close ? reversePolygon(mirrored) : mirrored;
      }),
    };
    if (shape.tabs) {
      flipped.tabs = shape.tabs.map((tab) => ({
        ...tab,
        points: tab.points.map((p) => flipPoint(p, frame)),
      }));
    }
    return flipped;
  });
}

/**
 * Where a flip step drills its dowel holes: on the line the board turns
 * over along, `inset` in from both its ends (so they're in the same place
 * either side up), through the board and `below` into the spoilboard.
 */
export type DowelHoles = { points: CamPoint[]; depth: number };

export function dowelHoles(
  stock: StockOptions,
  along: 'x' | 'y',
  inset: number,
  below: number,
): DowelHoles | null {
  const { across } = flipFrame(stock, along);
  const [from, length] =
    along === 'x' ? [stock.x, stock.width] : [stock.y, stock.height];
  const ends = [from + inset, from + length - inset];
  if (!(ends[1] - ends[0] > 0) || !(stock.thickness > 0)) {
    return null;
  }
  return {
    points: ends.map((at) =>
      along === 'x' ? { x: at, y: across } : { x: across, y: at },
    ),
    depth: stock.thickness + Math.max(0, below),
  };
}
