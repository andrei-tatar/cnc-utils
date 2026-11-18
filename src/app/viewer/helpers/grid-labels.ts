import { OrthographicCamera, Vector3 } from 'three';
import { GridSpacing, PlaneBounds, VerticalGridLayout } from './adaptive-grid';

/** Labels closer than this on screen are skipped to avoid overlaps. */
const MIN_LABEL_GAP_PX = 36;
const MAX_LABELS = 120;
/** Z numbers are left out when a major step is shorter than this on screen. */
const MIN_Z_STEP_PX = 12;
/** Labels keep this far inside the view, so their text fits. */
const LABEL_INSET = { left: 4, top: 16, right: 44, bottom: 40 };

type ScreenPoint = { x: number; y: number };
type ScreenRect = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The point of the segment `a` → `b` inside `view` nearest the one `wanted`
 * of the way along it (0 at `a`, 1 at `b`); null when none of it is inside.
 */
export function pointInView(
  a: ScreenPoint,
  b: ScreenPoint,
  wanted: number,
  view: ScreenRect,
): ScreenPoint | null {
  // Liang–Barsky: the part of the segment inside the rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - view.minX],
    [dx, view.maxX - a.x],
    [-dy, a.y - view.minY],
    [dy, view.maxY - a.y],
  ]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
  }
  if (!(t0 <= t1)) return null;
  const t = clamp(wanted, t0, t1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Millimetre labels for the major grid lines, as HTML over the canvas. X
 * values sit along the X axis and Y values along the Y axis; when an axis is
 * out of view they sit where their lines come into view nearest it, along
 * the edge of the screen. Z values go up the vertical grid's outer edge
 * (the one further right), or the screen's edge when that's out of view.
 */
export class GridLabels {
  private pool: HTMLSpanElement[] = [];

  constructor(private layer: HTMLElement) {}

  update(
    bounds: PlaneBounds,
    spacing: GridSpacing,
    camera: OrthographicCamera,
    width: number,
    height: number,
    /** The grid's height (Z). */
    z = 0,
    /** The vertical grid, when it's drawn. */
    vertical: VerticalGridLayout | null = null,
  ) {
    const { major } = spacing;
    const placed: Array<{ x: number; y: number }> = [];
    const labels: Array<{ text: string; x: number; y: number }> = [];

    const v = new Vector3();
    const toScreen = (x: number, y: number, at: number): ScreenPoint => {
      const p = v.set(x, y, at).project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };
    /** A label at a point on screen (its text goes right and down of it). */
    const placeAt = (at: ScreenPoint, text: string, dx: number, dy: number) => {
      const x = at.x + dx;
      const y = at.y + dy;
      if (x < 0 || y < 0 || x > width - 4 || y > height - 4) return;
      if (placed.some((o) => Math.hypot(o.x - x, o.y - y) < MIN_LABEL_GAP_PX)) {
        return;
      }
      placed.push({ x, y });
      labels.push({ text, x, y });
    };
    // Where a label still fits whole.
    const view = {
      minX: LABEL_INSET.left,
      minY: LABEL_INSET.top,
      maxX: width - LABEL_INSET.right,
      maxY: height - LABEL_INSET.bottom,
    };

    // A floor line's number sits where the line crosses the axis, or, with
    // that out of view, at the nearest point of the line that's in view: so
    // zoomed in on a part, the numbers run along the edge of the screen.
    const along = (min: number, max: number) =>
      max > min ? clamp((0 - min) / (max - min), 0, 1) : 0;
    const origin = toScreen(0, 0, z);
    placeAt(origin, '0', 4, 4);
    for (
      let x = Math.ceil(bounds.minX / major) * major;
      x <= bounds.maxX && labels.length < MAX_LABELS;
      x += major
    ) {
      if (Math.abs(x) > major / 2) {
        const at = pointInView(
          toScreen(x, bounds.minY, z),
          toScreen(x, bounds.maxY, z),
          along(bounds.minY, bounds.maxY),
          view,
        );
        if (at) placeAt(at, formatMm(x), 3, 3);
      }
    }
    for (
      let y = Math.ceil(bounds.minY / major) * major;
      y <= bounds.maxY && labels.length < MAX_LABELS;
      y += major
    ) {
      if (Math.abs(y) > major / 2) {
        const at = pointInView(
          toScreen(bounds.minX, y, z),
          toScreen(bounds.maxX, y, z),
          along(bounds.minX, bounds.maxX),
          view,
        );
        if (at) placeAt(at, formatMm(y), 4, -12);
      }
    }

    if (vertical) {
      const [first, corner, last] = vertical.corners;
      const from = toScreen(corner.x, corner.y, 0);
      const to = toScreen(corner.x, corner.y, major);
      if (Math.hypot(to.x - from.x, to.y - from.y) >= MIN_Z_STEP_PX) {
        // From Z0 outwards, so it's Z0 that's numbered when they're thinned.
        const values: number[] = [];
        for (
          let value = Math.ceil(vertical.minZ / major - 1e-6) * major;
          value <= vertical.maxZ + major * 1e-6;
          value += major
        ) {
          values.push(value);
        }
        values.sort((a, b) => Math.abs(a) - Math.abs(b));
        for (const value of values) {
          if (labels.length >= MAX_LABELS) break;
          // Each line runs along both walls: its number goes at the point
          // furthest right of what's in view — the walls' outer edge, or the
          // edge of the screen when that's out of view.
          const middle = toScreen(corner.x, corner.y, value);
          const at = [first, last]
            .map((end) =>
              pointInView(toScreen(end.x, end.y, value), middle, 0, view),
            )
            .filter((point): point is ScreenPoint => !!point)
            .reduce<ScreenPoint | null>(
              (best, point) => (!best || point.x > best.x ? point : best),
              null,
            );
          if (at) placeAt(at, formatMm(value), 6, -7);
        }
      }
    }

    while (this.pool.length < labels.length) {
      // Styled inline: these nodes are created outside Angular's templates,
      // so the component's encapsulated styles don't reach them.
      const span = document.createElement('span');
      span.style.cssText =
        'position:absolute;left:0;top:0;white-space:nowrap;' +
        'text-shadow:0 0 3px var(--pv-halo),0 0 3px var(--pv-halo);';
      this.layer.appendChild(span);
      this.pool.push(span);
    }
    this.pool.forEach((span, i) => {
      const label = labels[i];
      if (!label) {
        span.style.display = 'none';
        return;
      }
      span.style.display = '';
      span.textContent = label.text;
      span.style.transform = `translate(${Math.round(label.x)}px, ${Math.round(label.y)}px)`;
    });
  }
}

/**
 * The part of the XY plane the camera sees: the screen corners projected
 * onto it, limited to a few view-widths around the orbit target so a
 * grazing view doesn't stretch to infinity.
 */
export function visiblePlaneBounds(
  camera: OrthographicCamera,
  target: Vector3,
  /** The plane's height. */
  z = 0,
): PlaneBounds {
  camera.updateMatrixWorld();
  const viewWidth = (camera.right - camera.left) / camera.zoom;
  const viewHeight = (camera.top - camera.bottom) / camera.zoom;
  const limit = 4 * Math.max(viewWidth, viewHeight);
  const direction = camera.getWorldDirection(new Vector3());

  const xs: number[] = [];
  const ys: number[] = [];
  for (const [nx, ny] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const origin = new Vector3(nx, ny, -1).unproject(camera);
    let point: Vector3;
    if (Math.abs(direction.z) > 1e-6) {
      point = origin.addScaledVector(direction, (z - origin.z) / direction.z);
    } else {
      point = origin; // Looking along the plane: fall back to the corner.
    }
    xs.push(clamp(point.x, target.x - limit, target.x + limit));
    ys.push(clamp(point.y, target.y - limit, target.y + limit));
  }

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** A tidy millimetre value: no float noise, no trailing zeros. */
export function formatMm(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
