import {
  Box3,
  Color,
  ConeGeometry,
  InstancedBufferAttribute,
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
const ZERO_SCALE = new Vector3(0, 0, 0);
const ZERO_SCALE_MATRIX = new Matrix4();

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
 *
 * Levels (and the instance buffers) are only built once a zoom level first
 * needs them: most paths never show more than a handful of arrows, and a
 * program can have thousands of paths.
 */
export class DirectionArrows {
  readonly mesh: InstancedMesh;
  /** Where any arrow can be: lets the viewer skip off-screen paths. */
  readonly bounds: Box3;

  private readonly cumulative: number[] = [0];
  private readonly length: number;
  private readonly maxLevel: number;
  /** Candidates of the levels built so far, in level order. */
  private readonly positions: Vector3[] = [];
  private readonly rotations: Quaternion[] = [];
  /** Subdivision level of each instance (0 = the path's midpoint). */
  private readonly levels: number[] = [];
  /** Number of candidates up to and including each built level. */
  private readonly levelEnds: number[] = [];
  private colorAt: ((position: Vector3) => Color) | null = null;

  constructor(
    private readonly points: Vector3[],
    material: Material,
  ) {
    const cumulative = this.cumulative;
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

    // Grown as levels get built.
    this.mesh = new InstancedMesh(geometry, material, 1);
    this.mesh.count = 0;
    // Instances move around as the zoom changes; skip per-instance culling.
    this.mesh.frustumCulled = false;
    // Arrows sit on the path, so its points bound them.
    this.bounds = new Box3().setFromPoints(points);
  }

  /** Lay the arrows out for the current scale (screen pixels per unit). */
  update(pixelsPerUnit: number) {
    const level = this.visibleLevel(this.length * pixelsPerUnit);
    if (level < 0) {
      this.mesh.count = 0;
      return;
    }
    this.buildLevels(level);
    const count = this.levelEnds[level];
    const size = ARROW_PX / pixelsPerUnit;
    const scale = new Vector3(size, size, size);
    const matrix = new Matrix4();

    for (let i = 0; i < count; i++) {
      matrix.compose(this.positions[i], this.rotations[i], scale);
      this.mesh.setMatrixAt(i, matrix);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Number of arrows currently laid out (a prefix of all candidates). */
  get laidOut() {
    return this.mesh.count;
  }

  levelOf(index: number) {
    return this.levels[index];
  }

  positionOf(index: number) {
    return this.positions[index];
  }

  /** Hide one laid-out arrow (used to thin out arrows across paths). */
  hideArrow(index: number) {
    ZERO_SCALE_MATRIX.compose(
      this.positions[index],
      this.rotations[index],
      ZERO_SCALE,
    );
    this.mesh.setMatrixAt(index, ZERO_SCALE_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Lay out nothing (the path is off-screen or hidden). */
  clear() {
    this.mesh.count = 0;
  }

  /**
   * Give each arrow its own colour (multiplied with the material's), now
   * and for the levels built later.
   */
  colorBy(colorAt: (position: Vector3) => Color) {
    this.colorAt = colorAt;
    this.colorRange(0, this.positions.length);
  }

  dispose() {
    this.mesh.dispose();
  }

  /** The finest level to show for the path's on-screen length, or -1. */
  private visibleLevel(lengthPx: number) {
    if (this.maxLevel < 0 || lengthPx < MIN_PATH_PX) {
      return -1;
    }
    // Level k spaces arrows T / 2^k apart.
    return Math.min(
      this.maxLevel,
      Math.max(0, Math.floor(Math.log2(lengthPx / MIN_SPACING_PX))),
    );
  }

  /** Build the candidates of every level up to `level`. */
  private buildLevels(level: number) {
    const before = this.positions.length;
    for (let l = this.levelEnds.length; l <= level; l++) {
      const parts = 2 ** (l + 1);
      for (let j = 1; j < parts; j += 2) {
        this.addArrowAt((j * this.length) / parts, l);
      }
      this.levelEnds.push(this.positions.length);
    }
    if (this.positions.length > before) {
      this.reserve(this.positions.length);
      this.colorRange(before, this.positions.length);
    }
  }

  /** Make room for `count` instances (doubling, to grow only a few times). */
  private reserve(count: number) {
    const capacity = this.mesh.instanceMatrix.count;
    if (count <= capacity) {
      return;
    }
    const grown = Math.max(count, capacity * 2);
    const grow = (attribute: InstancedBufferAttribute) => {
      const array = new Float32Array(grown * attribute.itemSize);
      array.set(attribute.array);
      return new InstancedBufferAttribute(array, attribute.itemSize);
    };
    this.mesh.instanceMatrix = grow(this.mesh.instanceMatrix);
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor = grow(this.mesh.instanceColor);
    }
  }

  private colorRange(from: number, to: number) {
    if (!this.colorAt || from >= to) {
      return;
    }
    for (let i = from; i < to; i++) {
      this.mesh.setColorAt(i, this.colorAt(this.positions[i]));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private addArrowAt(s: number, level: number) {
    const { points, cumulative } = this;
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
