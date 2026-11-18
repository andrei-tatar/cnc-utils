import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Vector3,
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

/** The grid's colours: its lines, and the two through the origin. */
export type GridColors = {
  minor: Color;
  major: Color;
  xAxis: Color;
  yAxis: Color;
};

/**
 * A millimetre grid on the XY plane that follows the camera: spacing snaps to
 * 1-2-5 steps for the current zoom, and only the visible area is drawn. The
 * viewer keeps it under what's drawn (`floorHeight`).
 */
export class AdaptiveGrid extends LineSegments<
  BufferGeometry,
  LineBasicMaterial
> {
  /** The lines' colours, as of the next `update`. */
  colors: GridColors;

  constructor(colors: GridColors) {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    // Draw under shapes and toolpaths that sit at z = 0.
    this.renderOrder = -1;
    this.frustumCulled = false;
    this.colors = colors;
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
          ? this.colors.major
          : this.colors.minor;

    for (let x = x0; x <= x1 + minor / 2; x += minor) {
      line(x, y0, x, y1, colorFor(x, this.colors.yAxis));
    }
    for (let y = y0; y <= y1 + minor / 2; y += minor) {
      line(x0, y, x1, y, colorFor(y, this.colors.xAxis));
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

/** A box in the scene, as three's `Box3`. */
export type GridBox = { min: Vector3; max: Vector3 };

type GridCorner = { x: number; y: number };

/** Where the vertical grid stands, for its numbers. */
export type VerticalGridLayout = {
  minZ: number;
  maxZ: number;
  /**
   * The walls' upright edges seen from above: one's outer edge, the corner
   * they share, the other's outer edge.
   */
  corners: [GridCorner, GridCorner, GridCorner];
};

/** Looking this straight down (or up) the walls are edge-on: not drawn. */
const EDGE_ON = 0.995;
/** Past this many lines a wall is drawn with its major lines only. */
const MAX_WALL_LINES = 1000;

/**
 * The grid for Z: two upright walls behind what's drawn — on the sides of
 * its box away from the camera, as in a 3D chart — with the floor grid's
 * spacing, from the lowest to the highest thing in it.
 */
export class VerticalGrid extends LineSegments<
  BufferGeometry,
  LineBasicMaterial
> {
  colors: GridColors;

  constructor(colors: GridColors) {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.renderOrder = -1;
    this.frustumCulled = false;
    this.colors = colors;
  }

  /**
   * Rebuild the walls round `box` for a camera looking along `direction`.
   * Null (and nothing drawn) when there's no height to show or the walls
   * are edge-on.
   */
  update(
    box: GridBox,
    spacing: GridSpacing,
    direction: Vector3,
  ): VerticalGridLayout | null {
    const { minor, major } = spacing;
    const down = (value: number) => snapDown(value, minor);
    const up = (value: number) => snapUp(value, minor);
    const x0 = down(box.min.x);
    const x1 = up(box.max.x);
    const y0 = down(box.min.y);
    const y1 = up(box.max.y);
    const z0 = down(box.min.z);
    const z1 = up(box.max.z);

    this.visible =
      z1 - z0 > minor / 2 &&
      Math.abs(direction.z) < EDGE_ON &&
      [x0, x1, y0, y1, z0, z1].every(Number.isFinite);
    if (!this.visible) {
      return null;
    }

    // The sides away from the camera.
    const farX = direction.x >= 0 ? x1 : x0;
    const nearX = direction.x >= 0 ? x0 : x1;
    const farY = direction.y >= 0 ? y1 : y0;
    const nearY = direction.y >= 0 ? y0 : y1;

    const positions: number[] = [];
    const colors: number[] = [];
    const line = (a: number[], b: number[], color: Color) => {
      positions.push(...a, ...b);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };
    /** Each line's place from `from` to `to`, with its colour. */
    const lines = (
      from: number,
      to: number,
      draw: (value: number, color: Color) => void,
    ) => {
      const step = (to - from) / minor > MAX_WALL_LINES ? major : minor;
      const start = Math.ceil(from / step - 1e-6) * step;
      for (let value = start; value <= to + minor / 2; value += step) {
        draw(
          value,
          isMultiple(value, major, minor)
            ? this.colors.major
            : this.colors.minor,
        );
      }
    };

    lines(z0, z1, (z, color) => {
      line([x0, farY, z], [x1, farY, z], color);
      line([farX, y0, z], [farX, y1, z], color);
    });
    lines(x0, x1, (x, color) => line([x, farY, z0], [x, farY, z1], color));
    lines(y0, y1, (y, color) => line([farX, y, z0], [farX, y, z1], color));

    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    return {
      minZ: z0,
      maxZ: z1,
      corners: [
        { x: farX, y: nearY },
        { x: farX, y: farY },
        { x: nearX, y: farY },
      ],
    };
  }

  override dispose() {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}

/**
 * The height of the floor grid under (or, seen from below, over) `box`: its
 * side away from a camera looking along `direction`, on a grid line, where
 * the vertical grid's walls end too.
 */
export function floorHeight(
  box: GridBox,
  direction: Vector3,
  minor: number,
): number {
  const z =
    direction.z <= 0 ? snapDown(box.min.z, minor) : snapUp(box.max.z, minor);
  return Number.isFinite(z) ? z : 0;
}

function snapDown(value: number, step: number) {
  return Math.floor(value / step + 1e-6) * step;
}

function snapUp(value: number, step: number) {
  return Math.ceil(value / step - 1e-6) * step;
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
