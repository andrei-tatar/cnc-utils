import { OrthographicCamera, Vector3 } from 'three';
import { GridSpacing, PlaneBounds } from './adaptive-grid';

/** Labels closer than this on screen are skipped to avoid overlaps. */
const MIN_LABEL_GAP_PX = 36;
const MAX_LABELS = 120;

/**
 * Millimetre labels for the major grid lines, as HTML over the canvas. X
 * values sit along the X axis and Y values along the Y axis; when an axis is
 * off-screen they sit along the nearest edge of the visible grid instead.
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
  ) {
    const { major } = spacing;
    const placed: Array<{ x: number; y: number }> = [];
    const labels: Array<{ text: string; x: number; y: number }> = [];

    const place = (world: Vector3, text: string, dx: number, dy: number) => {
      const p = world.project(camera);
      const x = ((p.x + 1) / 2) * width + dx;
      const y = ((1 - p.y) / 2) * height + dy;
      if (x < 0 || y < 0 || x > width - 4 || y > height - 4) return;
      if (placed.some((o) => Math.hypot(o.x - x, o.y - y) < MIN_LABEL_GAP_PX)) {
        return;
      }
      placed.push({ x, y });
      labels.push({ text, x, y });
    };

    const xAxisY = clamp(0, bounds.minY, bounds.maxY);
    const yAxisX = clamp(0, bounds.minX, bounds.maxX);
    // With an axis off-screen its labels sit on the view's edge: nudge them
    // inwards so they stay visible.
    const xLabelDy = xAxisY <= bounds.minY ? -14 : 3;
    const yLabelDx = yAxisX >= bounds.maxX ? -34 : 4;
    const v = new Vector3();

    place(v.set(0, 0, z), '0', 4, 4);
    for (
      let x = Math.ceil(bounds.minX / major) * major;
      x <= bounds.maxX && labels.length < MAX_LABELS;
      x += major
    ) {
      if (Math.abs(x) > major / 2) {
        place(v.set(x, xAxisY, z), formatMm(x), 3, xLabelDy);
      }
    }
    for (
      let y = Math.ceil(bounds.minY / major) * major;
      y <= bounds.maxY && labels.length < MAX_LABELS;
      y += major
    ) {
      if (Math.abs(y) > major / 2) {
        place(v.set(yAxisX, y, z), formatMm(y), yLabelDx, -12);
      }
    }

    while (this.pool.length < labels.length) {
      // Styled inline: these nodes are created outside Angular's templates,
      // so the component's encapsulated styles don't reach them.
      const span = document.createElement('span');
      span.style.cssText =
        'position:absolute;left:0;top:0;white-space:nowrap;' +
        'text-shadow:0 0 3px #000,0 0 3px #000;';
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
 * onto z = 0, limited to a few view-widths around the orbit target so a
 * grazing view doesn't stretch to infinity.
 */
export function visiblePlaneBounds(
  camera: OrthographicCamera,
  target: Vector3,
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
      point = origin.addScaledVector(direction, -origin.z / direction.z);
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
