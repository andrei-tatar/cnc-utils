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
import { CamPoint, CamPoint3, CamShape } from '../../cam/types';
import { getDistance } from '../../util';
import { clearOverSurface, SurfaceClearingOptions } from './clear-surface';
import { brightnessAt, imagePixels } from './image-pixels';
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
  const tip = dropCutter(surface, options.tool);
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
  if (!relief.file || !(relief.depth > 0) || !(relief.resolution > 0)) {
    return null;
  }
  const region = await shapeRegion(input);
  if (!region.length) {
    return null;
  }
  const loops = region.map((p) => polygonPoints(p, curveTolerance()));
  const box = polygonsBounds(region);
  const border = reach + 2 * relief.resolution;
  const area =
    (box.maxX - box.minX + 2 * border) * (box.maxY - box.minY + 2 * border);
  const cell = Math.max(
    MIN_CELL,
    relief.resolution,
    Math.sqrt(area / MAX_CELLS),
  );
  const { map, placement } = await reliefMap(relief, box, cell);
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
      gamma: relief.gamma,
      invert: relief.invert,
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
): Promise<{ map: ReliefMap; placement: Bounds }> {
  // Turned a quarter (or three), width and height swap places.
  const turns = quarterTurns(relief.layout.rotation);
  const sideways = turns % 2 === 1;
  const cellsAcross = (mm: number, own = Infinity) =>
    Math.max(1, Math.min(own, MAX_PIXELS, Math.ceil(mm / cell)));

  if (/^data:image\//i.test(relief.file)) {
    let placement: Bounds = box;
    const pixels = await imagePixels(
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
    const drawn: ReliefMap = {
      width: pixels.width,
      height: pixels.height,
      data: new Float32Array(pixels.width * pixels.height),
    };
    for (let i = 0; i < drawn.data.length; i++) {
      drawn.data[i] = brightnessAt(pixels.data, i) / 255;
    }
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
