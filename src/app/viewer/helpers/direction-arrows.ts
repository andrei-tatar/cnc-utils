import {
  Color,
  ConeGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';

/** Arrow length on screen, in pixels. */
const ARROW_PX = 10;
/** Arrows along one path are at least this far apart on screen, in pixels. */
const MIN_SPACING_PX = 160;
/** Paths shorter than this on screen get no arrow at all, in pixels. */
const MIN_PATH_PX = 40;
/** Finest subdivision level: up to 2^(MAX_LEVEL+1)-1 arrows per path. */
const MAX_LEVEL = 9;
/** Don't subdivide below this spacing, in model units (mm). */
const MIN_SPACING = 0.25;

const UP = new Vector3(0, 1, 0);

// Unit cone pointing along +Y, centered on the origin.
const geometry = new ConeGeometry(0.35, 1, 10);

/**
 * Direction-of-travel arrowheads along a polyline, with a constant on-screen
 * size and a density that adapts to the zoom level.
 *
 * Candidate positions are laid out hierarchically by arc length: level 0 is
 * the midpoint, level k adds the odd multiples of T / 2^(k+1). Instances are
 * stored in level order, so showing "everything up to level k" is just
 * drawing a prefix of them (`mesh.count`) — no rebuilding on zoom.
 */
export class DirectionArrows {
  readonly mesh: InstancedMesh;

  private readonly length: number;
  private readonly maxLevel: number;
  private readonly positions: Vector3[] = [];
  private readonly rotations: Quaternion[] = [];
  /** Subdivision level of each instance (0 = the path's midpoint). */
  private readonly levels: number[] = [];
  private scale = 1;

  constructor(points: Vector3[], material: Material) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    this.length = cumulative[cumulative.length - 1] ?? 0;

    this.maxLevel =
      this.length > 0
        ? Math.max(
            0,
            Math.min(
              MAX_LEVEL,
              Math.floor(Math.log2(this.length / MIN_SPACING)),
            ),
          )
        : -1;

    for (let level = 0; level <= this.maxLevel; level++) {
      const parts = 2 ** (level + 1);
      for (let j = 1; j < parts; j += 2) {
        this.addArrowAt((j * this.length) / parts, points, cumulative, level);
      }
    }

    this.mesh = new InstancedMesh(
      geometry,
      material,
      Math.max(1, this.positions.length),
    );
    this.mesh.count = 0;
    // Instances move around as the zoom changes; skip per-instance culling.
    this.mesh.frustumCulled = false;
  }

  /** Lay the arrows out for the current scale (screen pixels per unit). */
  update(pixelsPerUnit: number) {
    const count = this.visibleCount(this.length * pixelsPerUnit);
    const size = ARROW_PX / pixelsPerUnit;
    this.scale = size;
    const scale = new Vector3(size, size, size);
    const matrix = new Matrix4();

    for (let i = 0; i < count; i++) {
      matrix.compose(this.positions[i], this.rotations[i], scale);
      this.mesh.setMatrixAt(i, matrix);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The arrows currently laid out, with their subdivision level. */
  *visibleArrows(): Generator<{
    index: number;
    level: number;
    position: Vector3;
  }> {
    for (let index = 0; index < this.mesh.count; index++) {
      yield {
        index,
        level: this.levels[index],
        position: this.positions[index],
      };
    }
  }

  /** Show or hide one arrow (used to thin out arrows across paths). */
  setArrowVisible(index: number, visible: boolean) {
    const scale = visible ? this.scale : 0;
    this.mesh.setMatrixAt(
      index,
      new Matrix4().compose(
        this.positions[index],
        this.rotations[index],
        new Vector3(scale, scale, scale),
      ),
    );
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Give each arrow its own colour (multiplied with the material's). */
  colorBy(colorAt: (position: Vector3) => Color) {
    this.positions.forEach((position, i) =>
      this.mesh.setColorAt(i, colorAt(position)),
    );
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.dispose();
  }

  private visibleCount(lengthPx: number) {
    if (this.maxLevel < 0 || lengthPx < MIN_PATH_PX) {
      return 0;
    }
    // Level k spaces arrows T / 2^k apart.
    const level = Math.min(
      this.maxLevel,
      Math.max(0, Math.floor(Math.log2(lengthPx / MIN_SPACING_PX))),
    );
    return Math.min(this.positions.length, 2 ** (level + 1) - 1);
  }

  private addArrowAt(
    s: number,
    points: Vector3[],
    cumulative: number[],
    level: number,
  ) {
    // Last vertex at or before arc length `s`, skipping zero-length segments.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    const segment = cumulative[hi] - cumulative[lo];
    if (segment <= 0) {
      return;
    }

    this.levels.push(level);
    this.positions.push(a.clone().lerp(b, (s - cumulative[lo]) / segment));
    this.rotations.push(
      new Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()),
    );
  }
}
