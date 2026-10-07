import { CamPoint, CamShape } from './types';

/** A kind of part to lay out: `count` copies of a `width` × `height` box. */
export type NestPart = {
  key: string;
  width: number;
  height: number;
  count: number;
  /** May be turned 90° (else its grain must run the way it's drawn). */
  rotate: boolean;
};

export type Sheet = {
  width: number;
  height: number;
  /** Kept clear along every edge of the sheet (mm). */
  margin: number;
  /** Between parts: at least the bit's diameter (mm). */
  gap: number;
};

/** Where one copy of a part goes. */
export type Placement = {
  key: string;
  /** Which copy of the part (from 0). */
  copy: number;
  /** Which sheet (from 0). */
  sheet: number;
  /** The part's box's bottom-left corner on its sheet. */
  x: number;
  y: number;
  /** Turned 90° counter-clockwise. */
  rotated: boolean;
  /** The part's size as placed (width along X). */
  width: number;
  height: number;
};

export type NestResult = {
  placements: Placement[];
  /** Copies too big for an empty sheet. */
  unplaced: { key: string; copy: number }[];
  sheets: number;
};

type Rect = { x: number; y: number; w: number; h: number };

const EPS = 1e-9;

/**
 * Lays out the parts' boxes on as few sheets as it can (MaxRects, best
 * short side fit, biggest parts first): rectangular parts, as cut from
 * sheet goods, pack well; other shapes are packed by their bounding box.
 */
export function nestRectangles(parts: NestPart[], sheet: Sheet): NestResult {
  const gap = Math.max(0, sheet.gap);
  const margin = Math.max(0, sheet.margin);
  // Each part takes its size plus the gap; the sheet gives the gap back on
  // its far edges, so parts can go right up to the margin.
  const freeW = sheet.width - 2 * margin + gap;
  const freeH = sheet.height - 2 * margin + gap;

  const copies = parts
    .flatMap((part) =>
      Array.from(
        { length: Math.max(0, Math.floor(part.count)) },
        (_, copy) => ({
          part,
          copy,
        }),
      ),
    )
    .filter(({ part }) => part.width > 0 && part.height > 0)
    .sort(
      (a, b) =>
        Math.max(b.part.width, b.part.height) -
          Math.max(a.part.width, a.part.height) ||
        b.part.width * b.part.height - a.part.width * a.part.height,
    );

  const sheets: Rect[][] = [];
  const placements: Placement[] = [];
  const unplaced: { key: string; copy: number }[] = [];

  for (const { part, copy } of copies) {
    const w = part.width + gap;
    const h = part.height + gap;
    const fitsEmpty =
      (w <= freeW + EPS && h <= freeH + EPS) ||
      (part.rotate && h <= freeW + EPS && w <= freeH + EPS);
    if (!fitsEmpty) {
      unplaced.push({ key: part.key, copy });
      continue;
    }
    let spot: { sheet: number; rect: Rect; rotated: boolean } | null = null;
    for (let s = 0; s < sheets.length && !spot; s++) {
      const found = bestSpot(sheets[s], w, h, part.rotate);
      if (found) spot = { sheet: s, ...found };
    }
    if (!spot) {
      sheets.push([{ x: 0, y: 0, w: freeW, h: freeH }]);
      const s = sheets.length - 1;
      spot = { sheet: s, ...bestSpot(sheets[s], w, h, part.rotate)! };
    }
    const used = spot.rect;
    split(sheets[spot.sheet], used);
    placements.push({
      key: part.key,
      copy,
      sheet: spot.sheet,
      x: margin + used.x,
      y: margin + used.y,
      rotated: spot.rotated,
      width: spot.rotated ? part.height : part.width,
      height: spot.rotated ? part.width : part.height,
    });
  }

  return { placements, unplaced, sheets: sheets.length };
}

/** The free rectangle that fits `w` × `h` (or turned) most snugly. */
function bestSpot(
  free: Rect[],
  w: number,
  h: number,
  rotate: boolean,
): { rect: Rect; rotated: boolean } | null {
  let best: { rect: Rect; rotated: boolean } | null = null;
  let bestShort = Infinity;
  let bestLong = Infinity;
  const consider = (f: Rect, rw: number, rh: number, rotated: boolean) => {
    if (rw > f.w + EPS || rh > f.h + EPS) return;
    const short = Math.min(f.w - rw, f.h - rh);
    const long = Math.max(f.w - rw, f.h - rh);
    if (
      short < bestShort - EPS ||
      (Math.abs(short - bestShort) <= EPS && long < bestLong)
    ) {
      bestShort = short;
      bestLong = long;
      best = { rect: { x: f.x, y: f.y, w: rw, h: rh }, rotated };
    }
  };
  for (const f of free) {
    consider(f, w, h, false);
    if (rotate && Math.abs(w - h) > EPS) consider(f, h, w, true);
  }
  return best;
}

/** Takes `used` out of the free rectangles (MaxRects split and prune). */
function split(free: Rect[], used: Rect) {
  const next: Rect[] = [];
  for (const f of free) {
    if (
      used.x >= f.x + f.w - EPS ||
      used.x + used.w <= f.x + EPS ||
      used.y >= f.y + f.h - EPS ||
      used.y + used.h <= f.y + EPS
    ) {
      next.push(f);
      continue;
    }
    if (used.x > f.x + EPS) next.push({ ...f, w: used.x - f.x });
    if (used.x + used.w < f.x + f.w - EPS) {
      next.push({ ...f, x: used.x + used.w, w: f.x + f.w - used.x - used.w });
    }
    if (used.y > f.y + EPS) next.push({ ...f, h: used.y - f.y });
    if (used.y + used.h < f.y + f.h - EPS) {
      next.push({ ...f, y: used.y + used.h, h: f.y + f.h - used.y - used.h });
    }
  }
  // Drop rectangles inside others.
  free.length = 0;
  next.forEach((a, i) => {
    const inside = next.some(
      (b, j) =>
        j !== i &&
        a.x >= b.x - EPS &&
        a.y >= b.y - EPS &&
        a.x + a.w <= b.x + b.w + EPS &&
        a.y + a.h <= b.y + b.h + EPS &&
        // Of two equal ones, keep the first.
        !(j > i && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h),
    );
    if (!inside) free.push(a);
  });
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** The box around every point of the shapes (null when there are none). */
export function shapesBox(shapes: CamShape[]): Box | null {
  let box: Box | null = null;
  for (const shape of shapes) {
    for (const polygon of shape.polygons) {
      for (const p of polygon.points) {
        if (!Number.isFinite(p.x + p.y)) continue;
        box = box
          ? {
              minX: Math.min(box.minX, p.x),
              minY: Math.min(box.minY, p.y),
              maxX: Math.max(box.maxX, p.x),
              maxY: Math.max(box.maxY, p.y),
            }
          : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      }
    }
  }
  return box;
}

/**
 * `shapes` moved as a copy of a part whose box is `box` is placed: turned
 * 90° counter-clockwise if `rotated`, its box's corner at `to`.
 */
export function placeShapes(
  shapes: CamShape[],
  box: Box,
  rotated: boolean,
  to: CamPoint,
  sourceShapeId: string,
): CamShape[] {
  const move = (p: CamPoint): CamPoint =>
    rotated
      ? { x: to.x + (box.maxY - p.y), y: to.y + (p.x - box.minX) }
      : { x: to.x + (p.x - box.minX), y: to.y + (p.y - box.minY) };
  return shapes.map((shape) => {
    const moved: CamShape = {
      sourceShapeId,
      polygons: shape.polygons.map((polygon) => ({
        close: polygon.close,
        points: polygon.points.map(move),
      })),
    };
    if (shape.tabs) {
      moved.tabs = shape.tabs.map((tab) => ({
        ...tab,
        points: tab.points.map(move),
      }));
    }
    return moved;
  });
}
