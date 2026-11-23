import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import { Bounds, polygonPoints, polygonsBounds } from '../../cam/arcs';
import {
  EngraveRun,
  ImageLayout,
  imagePlacement,
  quarterTurns,
  rasterRunsIn,
  rasterStretches,
  rotateBrightness,
} from '../../cam/image-engrave';
import { lowestReach } from '../../cam/image-engrave-clearing';
import {
  dropCutter,
  ReliefMap,
  reliefSurface,
  smoothRelief,
} from '../../cam/relief';
import { Heightmap, SimulatedTool } from '../../cam/simulate';
import { meshBounds, meshHeights, parseStl } from '../../cam/stl';
import { modelTurnedTo } from '../../cam/model-mesh';
import { Rotary, wrapRadius } from '../../cam/rotary';
import {
  radialDropCutter,
  radialTipSurface,
  UnrolledRelief,
  unrolledRelief,
} from '../../cam/rotary-relief';
import {
  clearedAbove,
  CutBefore,
  materialTop,
  materialWithin,
  sameAngle,
  SideSurface,
  sideSurface,
} from '../../cam/rotary-remaining';
import {
  isLeft,
  LeftToOthers,
  leftToOtherAngles,
} from '../../cam/rotary-sectors';
import { CamPoint, CamPoint3, CamShape } from '../../cam/types';
import { getDistance } from '../../util';
import { clearOverSurface, SurfaceClearingOptions } from './clear-surface';
import { imageBrightness } from './image-pixels';
import { shapeRegion } from './regions';

/** The relief itself: what it's carved from and how deep. */
export type ReliefSourceOptions = {
  /**
   * A greyscale image (light high, dark deep) or an STL model (seen from
   * above), as a data URL.
   */
  file: string;
  /** Where it goes on the shape. */
  layout: ImageLayout;
  /** Carve the high parts deepest instead (a mould). */
  invert: boolean;
  /** How deep its lowest is carved (mm). */
  depth: number;
  /** Depth follows (1 − height) raised to this. */
  gamma: number;
  /** Blurred over about this far first (mm). */
  smoothing: number;
  /** Inside the shape off the relief: uncut, or carved to the full depth. */
  around: 'surface' | 'floor';
  /** The surface is worked out on cells this size (mm). */
  resolution: number;
  /**
   * A 3D model shape's mesh to carve instead of the file (triangles in
   * design coordinates, Z 0 the top of the stock): carved where it is, at
   * its own heights, nothing more than `depth` below the top (the layout,
   * gamma and `invert` don't apply).
   */
  mesh?: Float32Array | null;
  /**
   * The mesh turns with the stock on its rotary axis: it's on the blank as
   * at 0°, and the operation, turned to `angle`, carves the side that's up
   * then (`depth` below the top as turned, at most).
   */
  turned?: {
    rotary: Rotary;
    angle: number;
    /**
     * The cuts of this relief made before this one, at whatever angle
     * (roughing and finishing): what they and the blank's own shape leave
     * as air is left out.
     */
    before?: CutBefore[];
    /**
     * The other angles this relief is finished at, when each angle only
     * finishes what faces it (see `leftToOtherAngles`).
     */
    shared?: number[];
    /**
     * The relief as the other angles in `before` and `shared` show it (see
     * `reliefSide`); one that's missing is worked out here.
     */
    sides?: SideSurface[];
    /**
     * Carved all round as the stock turns under the bit instead (the
     * relief is wrapped): `angle` is where the unrolling starts from. See
     * `unrolledRelief`.
     */
    around?: boolean;
  } | null;
  /**
   * With a mesh: carve within the rectangle round it as the operation
   * meets it, grown this much (mm), instead of within the shape given.
   */
  margin?: number;
};

export type ReliefOptions = {
  relief: ReliefSourceOptions;
  /** The bit (a ball nose, usually). */
  tool: SimulatedTool;
  /** Between raster lines (mm). */
  spacing: number;
  /** Direction of the lines, degrees counter-clockwise from the X axis. */
  angle: number;
  /** Every line cut the same way, instead of back and forth. */
  oneWay: boolean;
  /** A second pass with the lines across the first. */
  crossPass: boolean;
  /**
   * Carved all round as the stock turns (`relief.turned.around`): one cut
   * spiralling round the stock from one end to the other instead of
   * lines, `spacing` further along each turn.
   */
  spiral?: boolean;
  geometry?: GeometrySettings;
};

export type ReliefRoughingOptions = SurfaceClearingOptions & {
  relief: ReliefSourceOptions;
  /** Left above the relief (mm), for the finishing pass. */
  leaveStock: number;
  geometry?: GeometrySettings;
};

/**
 * A move is halved at most this many times to follow the relief (a cell
 * split 256 ways: a wall is cut within a µm of upright).
 */
const REFINE_LEVELS = 8;
/** Longer maps are scaled down to this many cells first. */
const MAX_PIXELS = 2400;
/** The surface keeps to about this many cells. */
const MAX_CELLS = 4_000_000;
/** Never finer than this (mm). */
const MIN_CELL = 0.02;
/**
 * A finishing line lifts over a stretch of air only when that's quicker
 * than carrying on through it: longer than this many times the way back
 * down (from safe height, at the plunge rate), and than two bit diameters.
 */
const LIFT_OVER_AIR = 4;
/** About how far above the top the bit travels (mm), for that. */
const TRAVEL_HEIGHT = 5;
/** The material's top is known about this well (mm), see `materialTop`. */
const MATERIAL_SLACK = 0.5;

/**
 * Carves a relief inside the shape: raster lines across it, the bit's tip
 * at each point as low as it goes without cutting into the relief anywhere
 * under it (a drop cutter), so a ball nose leaves the relief's shape, its
 * scallops aside. Optionally a second pass across the first.
 *
 * All of it in one go; the app shares the carving out between workers
 * instead (`prepareRelief`, then `routeReliefBand` for each part).
 */
export async function routeRelief(
  input: CamShape[],
  options: ReliefOptions,
): Promise<GCodeBuilder> {
  const prepared = await prepareRelief(input, options);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);
  if (!prepared) {
    return builder;
  }
  return builder
    .concat(
      await routeReliefBand(prepared, carvingOf(options), 0, prepared.units),
    )
    .goToSafeHeight();
}

/** How a relief is carved, once it's prepared (see `prepareRelief`). */
export type ReliefCarving = Omit<ReliefOptions, 'relief'>;

/** A relief's options without the relief itself. */
export function carvingOf(options: ReliefOptions): ReliefCarving {
  const { relief: _, ...carving } = options;
  return carving;
}

/**
 * A relief ready to carve: everything `routeReliefBand` needs, worked out
 * once for all the workers that share the carving.
 */
export type PreparedRelief = {
  sourceShapeId?: string;
  /** The surface to carve (unrolled, for one carved all round). */
  surface: Heightmap;
  loops: CamPoint[][];
  box: Bounds;
  /** Carved all round as the stock turns: its ends along the axis. */
  around: { rotary: Rotary; from: number; to: number } | null;
  /** Where there's material within the bit's reach, per cell (or all). */
  material: Float32Array | null;
  /** What's left to the other angles it's finished at. */
  left: LeftToOthers | null;
  /**
   * How many parts the carving comes in, to share out: stretches of its
   * raster lines (both passes'), or lengths of its spiral.
   */
  units: number;
};

/** A spiral is shared out in lengths of this many steps. */
const SPIRAL_UNIT = 2048;

/**
 * Prepares a relief for carving: its surface, where there's material left
 * and what's another angle's to finish. Null with nothing to carve.
 */
export async function prepareRelief(
  input: CamShape[],
  options: ReliefOptions,
): Promise<PreparedRelief | null> {
  useGeometry(options.geometry);
  const radius = options.tool.diameter / 2;
  if (!(radius > 0) || !(options.spacing > 0)) {
    return null;
  }
  const around = aroundTarget(options.relief, radius);
  const target = around ?? (await reliefTarget(input, options.relief, radius));
  if (!target) {
    return null;
  }
  const { surface, loops, box } = target;
  // Where earlier cuts at other angles (and the blank's shape) left only
  // air under the bit, there's nothing to carve.
  const remaining = await materialLeft(input, options.relief, surface);
  const material =
    remaining && materialWithin(remaining, surface, radius + MATERIAL_SLACK);
  // What another angle the relief is finished at faces more squarely is
  // left to that one.
  const others = await otherAngles(input, options.relief, radius);
  const left =
    others &&
    leftToOtherAngles(
      sideSurface(surface, options.relief.turned!.angle).mean,
      options.tool,
      options.relief.turned!.rotary,
      options.relief.turned!.angle,
      others,
    );
  const prepared: PreparedRelief = {
    sourceShapeId: input?.[0]?.sourceShapeId,
    surface,
    loops,
    box,
    around: around && {
      rotary: options.relief.turned!.rotary,
      from: around.from,
      to: around.to,
    },
    material: material || null,
    left: left || null,
    units: 0,
  };
  prepared.units = spiralOf(prepared, options)
    ? Math.ceil(spiralOf(prepared, options)!.steps / SPIRAL_UNIT)
    : passesOf(prepared, options).reduce((n, pass) => n + pass.stretches, 0);
  return prepared;
}

/** The raster passes of a relief: each one's angle and stretches. */
function passesOf(prepared: PreparedRelief, options: ReliefCarving) {
  const angles = [options.angle || 0];
  if (options.crossPass) angles.push((options.angle || 0) + 90);
  return angles.map((angle) => {
    const lines = {
      spacing: options.spacing,
      angle,
      oneWay: options.oneWay,
      start: { x: prepared.box.minX, y: prepared.box.minY },
    };
    return { lines, stretches: rasterStretches(prepared.loops, lines) };
  });
}

/**
 * The spiral of a relief carved all round in one (null for any other):
 * round and round, the stock turning one way all along — a ring at the
 * start, then `spacing` further along each turn, and a ring at the end, so
 * both ends are finished square. In `steps` steps of about a cell.
 */
function spiralOf(prepared: PreparedRelief, options: ReliefCarving) {
  const { around, surface } = prepared;
  if (!around || !options.spiral) {
    return null;
  }
  const alongX = around.rotary.along === 'x';
  const round = 2 * Math.PI * wrapRadius(around.rotary);
  const length = around.to - around.from;
  const total = round * (2 + length / options.spacing);
  const steps = Math.max(1, Math.ceil(total / surface.cell));
  return {
    steps,
    at: (n: number): CamPoint => {
      const s = (total * n) / steps;
      const along =
        around.from +
        Math.min(length, Math.max(0, ((s - round) / round) * options.spacing));
      const across = around.rotary.across - round / 2 + s;
      return alongX ? { x: along, y: across } : { x: across, y: along };
    },
  };
}

/**
 * Carves parts `from` up to `to` of a prepared relief (of its `units`):
 * exactly what carving it all in one go gives for them, so the parts'
 * G-code, one after the other, is the whole carving. Ends down, wherever
 * its last cut ends.
 */
export async function routeReliefBand(
  prepared: PreparedRelief,
  options: ReliefCarving,
  from: number,
  to: number,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const { surface, loops, around, material, left } = prepared;
  let builder = new GCodeBuilder();
  const radius = options.tool.diameter / 2;
  const tip = around
    ? radialDropCutter(
        { surface, loops, box: prepared.box, from: around.from, to: around.to },
        around.rotary,
        options.tool,
      )
    : dropCutter(surface, options.tool, loops);
  const depth = (p: CamPoint) => Math.max(0, -tip(p));
  const skipped = !!(material || left);
  const inAir = (p: CamPoint3) => {
    if (left && isLeft(left, p)) return true;
    if (!material) return false;
    const i = Math.floor((p.x - surface.minX) / surface.cell);
    const j = Math.floor((p.y - surface.minY) / surface.cell);
    if (i < 0 || j < 0 || i >= surface.nx || j >= surface.ny) return false;
    return p.z >= material[j * surface.nx + i];
  };

  const tolerance = curveTolerance();
  let at: CamPoint3 = { x: 0, y: 0, z: 0 };
  /**
   * Carves straight on to `to`, with points in between where the bit would
   * otherwise stray from the relief: where a steep wall stands, the bit's
   * height jumps from one sample to the next, and a straight move between
   * them would cut into the wall.
   */
  const carveTo = (to: CamPoint3, levels = REFINE_LEVELS) => {
    const start = at;
    if (levels > 0) {
      const mid = { x: (start.x + to.x) / 2, y: (start.y + to.y) / 2 };
      const z = -depth(mid);
      if (Math.abs(z - (start.z + to.z) / 2) > tolerance) {
        carveTo({ ...mid, z }, levels - 1);
        carveTo(to, levels - 1);
        return;
      }
    }
    builder.carveTo(to.x, to.y, to.z);
    at = to;
  };

  const spiral = spiralOf(prepared, options);
  if (spiral) {
    const point = (n: number): CamPoint3 => {
      const p = spiral.at(n);
      return { ...p, z: -depth(p) };
    };
    const first = Math.min(spiral.steps, from * SPIRAL_UNIT);
    const last = Math.min(spiral.steps, to * SPIRAL_UNIT);
    at = point(first);
    if (!from) {
      builder.goToSafeHeight();
      builder.travelTo(at.x, at.y);
      builder.plunge(at.z);
    }
    // Points in a line (within the tolerance) are passed over; never past
    // the end of a length, so the lengths can be carved apart.
    let pending: CamPoint3[] = [];
    const straight = (next: CamPoint3) => {
      const d = { x: next.x - at.x, y: next.y - at.y, z: next.z - at.z };
      const l2 = d.x * d.x + d.y * d.y + d.z * d.z;
      return pending.every((p) => {
        const e = { x: p.x - at.x, y: p.y - at.y, z: p.z - at.z };
        const t = l2 > 0 ? (e.x * d.x + e.y * d.y + e.z * d.z) / l2 : 0;
        return (
          Math.hypot(e.x - d.x * t, e.y - d.y * t, e.z - d.z * t) <= tolerance
        );
      });
    };
    const flush = () => {
      if (pending.length) carveTo(pending[pending.length - 1]);
      pending = [];
    };
    for (let n = first + 1; n <= last; n++) {
      const p = point(n);
      if (pending.length && (pending.length >= 64 || !straight(p))) flush();
      pending.push(p);
      if (n % SPIRAL_UNIT === 0) flush();
    }
    flush();
    return builder;
  }

  /** Carves a run of a raster line, after the one before it. */
  let carvedLast = false;
  const carveRun = ({ points: all, linked }: EngraveRun) => {
    const pieces = skipped ? carvedPieces(all, inAir, radius) : [all];
    pieces.forEach((points, k) => {
      const [first, ...rest] = points;
      // A line trimmed of its air is still gone over to along the
      // relief, when that's not far.
      const near =
        getDistance(at, first) <=
        Math.max(4 * radius, LIFT_OVER_AIR * (TRAVEL_HEIGHT - first.z));
      if (linked && k === 0 && carvedLast && (skipped ? near : true)) {
        // Over to the next line along the relief, as low as the bit goes.
        const start = at;
        const length = getDistance(start, first);
        const steps = Math.ceil(length / surface.cell);
        for (let n = 1; n < steps; n++) {
          const p = {
            x: start.x + ((first.x - start.x) * n) / steps,
            y: start.y + ((first.y - start.y) * n) / steps,
          };
          carveTo({ ...p, z: -depth(p) });
        }
        carveTo(first);
      } else {
        builder.goToSafeHeight();
        builder.travelTo(first.x, first.y);
        builder.plunge(first.z);
        at = first;
      }
      for (const p of rest) {
        carveTo(p);
      }
    });
    // Whether any of it was carved (so the next can be gone over to along
    // the relief).
    carvedLast = pieces.length > 0;
  };

  // Each pass' stretches that fall within this part.
  let done = 0;
  for (const pass of passesOf(prepared, options)) {
    const start = Math.max(0, from - done);
    const end = Math.min(pass.stretches, to - done);
    done += pass.stretches;
    if (end <= start) continue;
    const { before, runs } = rasterRunsIn(
      loops,
      depth,
      { ...pass.lines, sampleStep: surface.cell, tolerance },
      start,
      end,
    );
    carvedLast = false;
    if (before) {
      // Where the run before this part leaves the bit: carved for that
      // alone, its cuts thrown away.
      const real = builder;
      builder = new GCodeBuilder();
      carveRun(before);
      builder = real;
    }
    runs.forEach(carveRun);
  }
  return builder;
}

/**
 * Clears the bulk of a relief with an end mill, so the finishing pass only
 * takes what's left: level by level, never closer than `leaveStock` to the
 * relief (see `clearOverSurface`).
 */
export async function routeReliefRough(
  input: CamShape[],
  options: ReliefRoughingOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);
  const radius = options.toolSize / 2;
  if (!(radius > 0) || !(options.toolEngagement > 0)) {
    return builder;
  }
  const margin = Math.max(0, options.leaveStock);
  const around = aroundTarget(options.relief, radius, ROUGH_AROUND_CELL);
  if (around) {
    // All round the stock: where the end mill's axis may go, with the
    // model as it really is under it.
    const lowest = radialTipSurface(around, options.relief.turned!.rotary, {
      bitType: 'end-mill',
      diameter: options.toolSize,
    });
    let deepest = 0;
    for (const z of lowest.heights) deepest = Math.min(deepest, z);
    await clearOverSurface(builder, lowest, margin, -deepest - margin, {
      ...options,
      centres: true,
    });
    builder.goToSafeHeight();
    return builder;
  }
  const target = await reliefTarget(input, options.relief, radius);
  if (!target) {
    return builder;
  }
  // Down to the deepest the end mill reaches without cutting into it.
  const total = -lowestReach(target.surface, radius) - margin;
  const remaining = await materialLeft(input, options.relief, target.surface);
  await clearOverSurface(
    builder,
    target.surface,
    margin,
    total,
    options,
    // The bit's centre comes within its radius of material: its area is
    // this, drawn in by the radius.
    remaining
      ? materialWithin(remaining, target.surface, 2 * radius + MATERIAL_SLACK)
      : undefined,
  );
  builder.goToSafeHeight();
  return builder;
}

/** Roughing all round the stock works on cells no finer than this (mm). */
const ROUGH_AROUND_CELL = 0.25;

/**
 * For a relief carved all round as the stock turns (`turned.around`): its
 * model unrolled (see `unrolledRelief`), `reach` mm of uncut surface past
 * its ends. Null for any other relief.
 */
function aroundTarget(
  relief: ReliefSourceOptions,
  reach: number,
  coarsest = 0,
): UnrolledRelief | null {
  const turned = relief.turned;
  if (
    !turned?.around ||
    !relief.mesh?.length ||
    !(relief.depth > 0) ||
    !(relief.resolution > 0)
  ) {
    return null;
  }
  const b = meshBounds(relief.mesh);
  const length =
    (turned.rotary.along === 'x' ? b.maxX - b.minX : b.maxY - b.minY) +
    2 * Math.max(0, relief.margin ?? 0);
  const round = 2 * Math.PI * wrapRadius(turned.rotary);
  return unrolledRelief(relief.mesh, turned.rotary, {
    angle: turned.angle,
    depth: relief.depth,
    around: relief.around,
    margin: relief.margin ?? 0,
    cell: Math.max(
      MIN_CELL,
      relief.resolution,
      coarsest,
      Math.sqrt((length * round) / MAX_CELLS),
    ),
    border: reach + 2 * relief.resolution,
  });
}

/**
 * A finishing line's points in the pieces that are carved: without the
 * stretches where the bit only meets air (`inAir`), unless they're short —
 * then it carries on through rather than lift. A point is kept either side
 * of each piece, so the bit is on its way when it meets the material.
 */
function carvedPieces(
  points: CamPoint3[],
  inAir: (p: CamPoint3) => boolean,
  radius: number,
): CamPoint3[][] {
  const keep = points.map((p) => !inAir(p));
  // Through stretches of air too short to be worth lifting over.
  for (let i = 0; i < points.length;) {
    if (keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < points.length && !keep[end]) end++;
    const between = i > 0 && end < points.length;
    if (
      between &&
      getDistance(points[i - 1], points[end]) <=
        Math.max(4 * radius, LIFT_OVER_AIR * (TRAVEL_HEIGHT - points[end].z))
    ) {
      keep.fill(true, i, end);
    }
    i = end;
  }
  const pieces: CamPoint3[][] = [];
  for (let i = 0; i < points.length;) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < points.length && keep[end]) end++;
    pieces.push(
      points.slice(Math.max(0, i - 1), Math.min(points.length, end + 1)),
    );
    i = end;
  }
  return pieces;
}

/**
 * For a relief whose model turns with the stock: how high material still
 * stands over each cell of `surface` when this cut is made (see
 * `materialTop`), from the blank's shape and the cuts before. Null for any
 * other relief: all of it is carved.
 */
async function materialLeft(
  input: CamShape[],
  relief: ReliefSourceOptions,
  surface: Heightmap,
): Promise<Float32Array | null> {
  const turned = relief.turned;
  if (!turned || turned.around || !relief.mesh?.length) {
    return null;
  }
  const cleared: { angle: number; above: Heightmap }[] = [];
  for (const cut of turned.before ?? []) {
    // This angle's own surface is at hand; another's comes with the job.
    const there = sameAngle(cut.angle, turned.angle)
      ? surface
      : (await sideAt(input, relief, cut.angle, cut.radius))?.high;
    if (there) {
      cleared.push({
        angle: cut.angle,
        above: clearedAbove(there, cut, MATERIAL_SLACK),
      });
    }
  }
  return materialTop(
    surface,
    turned.rotary,
    turned.angle,
    -Math.max(0, relief.depth),
    cleared,
  );
}

/**
 * The relief as the stock turned to `angle` shows it: what came with the
 * job (`turned.sides`), else worked out here (`reach` mm round it).
 */
async function sideAt(
  input: CamShape[],
  relief: ReliefSourceOptions,
  angle: number,
  reach: number,
): Promise<SideSurface | null> {
  const turned = relief.turned!;
  const given = turned.sides?.find((side) => sameAngle(side.angle, angle));
  if (given) {
    return given;
  }
  const target = await reliefTarget(
    input,
    { ...relief, turned: { rotary: turned.rotary, angle } },
    reach,
  );
  return target && sideSurface(target.surface, angle);
}

/**
 * The other angles a relief whose model turns with the stock is finished
 * at, as each shows it; null when it isn't shared out between them.
 */
async function otherAngles(
  input: CamShape[],
  relief: ReliefSourceOptions,
  radius: number,
): Promise<SideSurface[] | null> {
  const turned = relief.turned;
  if (!turned?.shared?.length || !relief.mesh?.length) {
    return null;
  }
  const sides: SideSurface[] = [];
  for (const angle of turned.shared) {
    if (sameAngle(angle, turned.angle)) continue;
    const side = await sideAt(input, relief, angle, radius);
    if (side) sides.push(side);
  }
  return sides;
}

/**
 * A relief whose model turns with the stock, as the stock turned to its
 * angle (`relief.turned.angle`) shows it, for the cuts made at other
 * angles (see `SideSurface`): a job of its own, so every cut that needs it
 * shares the one.
 */
export async function reliefSide(
  input: CamShape[],
  relief: ReliefSourceOptions,
  reach: number,
  geometry?: GeometrySettings,
): Promise<SideSurface | null> {
  useGeometry(geometry);
  if (!relief.turned) {
    return null;
  }
  const target = await reliefTarget(input, relief, reach);
  return target && sideSurface(target.surface, relief.turned.angle);
}

/**
 * The relief to carve inside the shape, as a surface (see `reliefSurface`)
 * reaching `reach` mm round the shape and more; null when there's nothing
 * to carve.
 */
async function reliefTarget(
  input: CamShape[],
  relief: ReliefSourceOptions,
  reach: number,
): Promise<{ surface: Heightmap; loops: CamPoint[][]; box: Bounds } | null> {
  if (
    !(relief.mesh?.length || relief.file) ||
    !(relief.depth > 0) ||
    !(relief.resolution > 0)
  ) {
    return null;
  }
  // The mesh as this operation meets it: Z from the top (as turned).
  const seen = !relief.mesh?.length
    ? null
    : relief.turned
      ? modelTurnedTo(relief.mesh, relief.turned.rotary, relief.turned.angle)
      : relief.mesh;
  let loops: CamPoint[][];
  let box: Bounds;
  if (seen && relief.margin !== undefined) {
    // Within the rectangle round the model, and a margin.
    const b = meshBounds(seen);
    const m = Math.max(0, relief.margin);
    box = {
      minX: b.minX - m,
      maxX: b.maxX + m,
      minY: b.minY - m,
      maxY: b.maxY + m,
    };
    loops = [
      [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ],
    ];
  } else {
    const region = await shapeRegion(input);
    if (!region.length) {
      return null;
    }
    loops = region.map((p) => polygonPoints(p, curveTolerance()));
    box = polygonsBounds(region);
  }
  const border = reach + 2 * relief.resolution;
  const area =
    (box.maxX - box.minX + 2 * border) * (box.maxY - box.minY + 2 * border);
  const cell = Math.max(
    MIN_CELL,
    relief.resolution,
    Math.sqrt(area / MAX_CELLS),
  );
  const { map, placement, absolute } = await reliefMap(relief, box, cell, seen);
  const smoothed = smoothRelief(
    map,
    relief.smoothing / ((placement.maxX - placement.minX) / map.width),
  );
  const surface = reliefSurface(
    smoothed,
    loops,
    {
      placement,
      depth: relief.depth,
      gamma: absolute ? 1 : relief.gamma,
      invert: absolute ? false : relief.invert,
      around: relief.around,
    },
    cell,
    border + cell,
  );
  return { surface, loops, box };
}

/**
 * The relief's heights from its file (an image, light high, or an STL
 * model seen from above), laid on `box` as its layout says, about a cell
 * per `cell` mm (no more than the image has).
 */
async function reliefMap(
  relief: ReliefSourceOptions,
  box: Bounds,
  cell: number,
  /** A 3D model shape's mesh, as the operation meets it. */
  mesh: Float32Array | null,
): Promise<{
  map: ReliefMap;
  placement: Bounds;
  /** The map's heights are true ones (a 3D model shape's). */
  absolute?: boolean;
}> {
  if (mesh) {
    const b = meshBounds(mesh);
    const cells = (mm: number) =>
      Math.max(1, Math.min(MAX_PIXELS, Math.ceil(mm / cell)));
    const map = meshHeights(
      mesh,
      cells(b.maxX - b.minX),
      cells(b.maxY - b.minY),
    );
    // From the mesh's own lowest – highest to the top – `depth` below it:
    // what's above the stock can't be added, what's lower isn't carved.
    const rise = b.maxZ - b.minZ;
    const depth = Math.max(relief.depth, 1e-9);
    for (let k = 0; k < map.data.length; k++) {
      const z = b.minZ + map.data[k] * rise;
      map.data[k] = Math.min(1, Math.max(0, 1 + z / depth));
    }
    return {
      map,
      placement: { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY },
      absolute: true,
    };
  }
  // Turned a quarter (or three), width and height swap places.
  const turns = quarterTurns(relief.layout.rotation);
  const sideways = turns % 2 === 1;
  const cellsAcross = (mm: number, own = Infinity) =>
    Math.max(1, Math.min(own, MAX_PIXELS, Math.ceil(mm / cell)));

  if (/^data:image\//i.test(relief.file)) {
    let placement: Bounds = box;
    const drawn = await imageBrightness(
      relief.file,
      (width, height) => {
        const [w, h] = sideways ? [height, width] : [width, height];
        placement = imagePlacement(box, w, h, relief.layout);
        const wide = cellsAcross(placement.maxX - placement.minX, w);
        const high = cellsAcross(placement.maxY - placement.minY, h);
        // Drawn as it is, turned after.
        return sideways
          ? { width: high, height: wide }
          : { width: wide, height: high };
      },
      'high',
    );
    return { map: rotateBrightness(drawn, turns), placement };
  }

  const triangles = parseStl(await (await fetch(relief.file)).arrayBuffer());
  const b = meshBounds(triangles);
  const [w, h] = sideways
    ? [b.maxY - b.minY, b.maxX - b.minX]
    : [b.maxX - b.minX, b.maxY - b.minY];
  const placement = imagePlacement(box, w, h, relief.layout);
  const wide = cellsAcross(placement.maxX - placement.minX);
  const high = cellsAcross(placement.maxY - placement.minY);
  const seen = sideways
    ? meshHeights(triangles, high, wide)
    : meshHeights(triangles, wide, high);
  return { map: rotateBrightness(seen, turns), placement };
}
