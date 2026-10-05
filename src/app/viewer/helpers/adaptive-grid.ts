import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three';

/** Visible part of the XY plane, in mm. */
export type PlaneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type GridSpacing = {
  /** Distance between minor lines, in mm. */
  minor: number;
  /** Distance between labelled major lines, in mm. */
  major: number;
};

/** Minor lines are kept at least this far apart on screen. */
const MIN_MINOR_PX = 18;
/** Safety cap so a grazing view can't produce millions of lines. */
const MAX_LINES_PER_AXIS = 400;

const MINOR_COLOR = new Color(0x262626);
const MAJOR_COLOR = new Color(0x4a4a4a);
const X_AXIS_COLOR = new Color(0x8a3030);
const Y_AXIS_COLOR = new Color(0x2f7a2f);

/**
 * A millimetre grid on the XY plane that follows the camera: spacing snaps to
 * 1-2-5 steps for the current zoom, and only the visible area is drawn.
 */
export class AdaptiveGrid extends LineSegments<
  BufferGeometry,
  LineBasicMaterial
> {
  constructor() {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    // Draw under shapes and toolpaths that sit at z = 0.
    this.renderOrder = -1;
    this.frustumCulled = false;
  }

  /** Rebuild the lines for the visible bounds and scale (pixels per mm). */
  update(bounds: PlaneBounds, pixelsPerUnit: number): GridSpacing {
    const spacing = gridSpacing(pixelsPerUnit, bounds);
    const { minor, major } = spacing;

    const x0 = Math.floor(bounds.minX / minor) * minor;
    const x1 = Math.ceil(bounds.maxX / minor) * minor;
    const y0 = Math.floor(bounds.minY / minor) * minor;
    const y1 = Math.ceil(bounds.maxY / minor) * minor;

    const positions: number[] = [];
    const colors: number[] = [];
    const line = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      color: Color,
    ) => {
      positions.push(ax, ay, 0, bx, by, 0);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };
    const colorFor = (value: number, axis: Color) =>
      isMultiple(value, 0, minor)
        ? axis
        : isMultiple(value, major, minor)
          ? MAJOR_COLOR
          : MINOR_COLOR;

    for (let x = x0; x <= x1 + minor / 2; x += minor) {
      line(x, y0, x, y1, colorFor(x, Y_AXIS_COLOR));
    }
    for (let y = y0; y <= y1 + minor / 2; y += minor) {
      line(x0, y, x1, y, colorFor(y, X_AXIS_COLOR));
    }

    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    return spacing;
  }

  override dispose() {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}

/** Snap to 1, 2 or 5 × 10^n mm so lines are at least MIN_MINOR_PX apart. */
export function gridSpacing(
  pixelsPerUnit: number,
  bounds: PlaneBounds,
): GridSpacing {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const wanted = Math.max(
    MIN_MINOR_PX / Math.max(pixelsPerUnit, 1e-9),
    span / MAX_LINES_PER_AXIS,
  );
  const power = 10 ** Math.floor(Math.log10(wanted));
  const minor =
    [1, 2, 5, 10].map((m) => m * power).find((step) => step >= wanted) ??
    10 * power;
  // Majors land on round numbers: 1 → 5, 2 → 10, 5 → 10 (× 10^n).
  const leading = Math.round(minor / power);
  const major = minor * (leading === 5 ? 2 : leading === 2 ? 5 : 5);
  return { minor, major };
}

function isMultiple(value: number, of: number, tolerance: number) {
  if (of === 0) {
    return Math.abs(value) < tolerance / 2;
  }
  const r = Math.abs(value / of - Math.round(value / of));
  return r * of < tolerance / 2;
}
