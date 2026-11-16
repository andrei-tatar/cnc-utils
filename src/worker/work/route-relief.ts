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
  rasterRuns,
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
import { Rotary } from '../../cam/rotary';
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
  turned?: { rotary: Rotary; angle: number } | null;
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
 * Carves a relief inside the shape: raster lines across it, the bit's tip
 * at each point as low as it goes without cutting into the relief anywhere
 * under it (a drop cutter), so a ball nose leaves the relief's shape, its
 * scallops aside. Optionally a second pass across the first.
 */
export async function routeRelief(
  input: CamShape[],
  options: ReliefOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);
  const radius = options.tool.diameter / 2;
  if (!(radius > 0) || !(options.spacing > 0)) {
    return builder;
  }
  const target = await reliefTarget(input, options.relief, radius);
  if (!target) {
    return builder;
  }
  const { surface, loops, box } = target;
  const tip = dropCutter(surface, options.tool, loops);
  const depth = (p: CamPoint) => Math.max(0, -tip(p));
  const passes = [options.angle || 0];
  if (options.crossPass) passes.push((options.angle || 0) + 90);

  const tolerance = curveTolerance();
  let at: CamPoint3 = { x: 0, y: 0, z: 0 };
  /**
   * Carves straight on to `to`, with points in between where the bit would
   * otherwise stray from the relief: where a steep wall stands, the bit's
   * height jumps from one sample to the next, and a straight move between
   * them would cut into the wall.
   */
  const carveTo = (to: CamPoint3, levels = REFINE_LEVELS) => {
    const from = at;
    if (levels > 0) {
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const z = -depth(mid);
      if (Math.abs(z - (from.z + to.z) / 2) > tolerance) {
        carveTo({ ...mid, z }, levels - 1);
        carveTo(to, levels - 1);
        return;
      }
    }
    builder.carveTo(to.x, to.y, to.z);
    at = to;
  };

  for (const angle of passes) {
    const runs: EngraveRun[] = rasterRuns(loops, depth, {
      spacing: options.spacing,
      angle,
      sampleStep: surface.cell,
      oneWay: options.oneWay,
      tolerance,
      start: { x: box.minX, y: box.minY },
    });
    for (const { points, linked } of runs) {
      const [first, ...rest] = points;
      if (linked) {
        // Over to the next line along the relief, as low as the bit goes.
        const from = at;
        const length = getDistance(from, first);
        const steps = Math.ceil(length / surface.cell);
        for (let k = 1; k < steps; k++) {
          const p = {
            x: from.x + ((first.x - from.x) * k) / steps,
            y: from.y + ((first.y - from.y) * k) / steps,
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
    }
  }
  builder.goToSafeHeight();
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
  const target = await reliefTarget(input, options.relief, radius);
  if (!target) {
    return builder;
  }
  const margin = Math.max(0, options.leaveStock);
  // Down to the deepest the end mill reaches without cutting into it.
  const total = -lowestReach(target.surface, radius) - margin;
  await clearOverSurface(builder, target.surface, margin, total, options);
  builder.goToSafeHeight();
  return builder;
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
