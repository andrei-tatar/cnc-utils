import { Bounds } from './arcs';
import { rasterLines, rasterPaths, staysInside } from './raster';
import { CamPoint, CamPoint3 } from './types';
import { getDistance } from '../util';

/** An image's brightness, 0 (black) to 1 (white), row by row from the top. */
export type Brightness = {
  width: number;
  height: number;
  data: Float32Array;
};

/**
 * How the image fills the shape's bounding box: all of it inside, keeping
 * its proportions (`contain`), covering the box, cropped (`cover`), or
 * stretched to it.
 */
export type ImageFit = 'contain' | 'cover' | 'stretch';

export type EngraveOptions = {
  /** Where the image lies, in design coordinates. */
  placement: Bounds;
  /** How deep white (or, inverted, black) is carved (mm). */
  lightDepth: number;
  /** How deep black (or, inverted, white) is carved (mm). */
  darkDepth: number;
  /** Depth follows darkness raised to this: above 1 lightens mid-tones. */
  gamma: number;
  /** Carve the light areas deepest instead. */
  invert: boolean;
  /** Between raster lines (mm). */
  spacing: number;
  /** Direction of the lines, degrees counter-clockwise from the X axis. */
  angle: number;
  /** Between samples of the image along a line (mm). */
  sampleStep: number;
  /** Every line cut the same way, instead of back and forth. */
  oneWay: boolean;
  /** How far (mm) the cut may stray from the image's depth to lose points. */
  tolerance: number;
};

/** One stretch cut without lifting, its points with Z (negative: below). */
export type EngraveRun = {
  points: CamPoint3[];
  /**
   * Reached from the run before at the surface, inside the area (otherwise
   * over safe height).
   */
  linked: boolean;
};

/**
 * Stretches at the surface (nothing to carve) longer than this (mm) are
 * crossed at safe height; shorter ones, and the step to the next line, at
 * the surface.
 */
export const LIFT_OVER = 5;

/** Depths this close to the surface carve nothing. */
const SURFACE = 1e-6;

/** Where the image goes on its shape. */
export type ImageLayout = {
  /** How it fills the shape's bounding box, before scaling. */
  fit: ImageFit;
  /** Percent of the fitted size. */
  scale: number;
  /** Which side of the box it keeps to, across and up. */
  alignX: 'left' | 'center' | 'right';
  alignY: 'bottom' | 'middle' | 'top';
  /** Moved this far from there (mm). */
  offsetX: number;
  offsetY: number;
  /** Turned clockwise this far first: 0, 90, 180 or 270 (degrees). */
  rotation?: number;
};

/** Clockwise quarter turns for `rotation` (degrees), 0 – 3. */
export function quarterTurns(rotation: number | undefined): number {
  return ((Math.round((rotation ?? 0) / 90) % 4) + 4) % 4;
}

/** `image` turned clockwise `turns` quarter turns. */
export function rotateBrightness(image: Brightness, turns: number): Brightness {
  const t = ((turns % 4) + 4) % 4;
  if (!t) return image;
  const { width: w, height: h, data } = image;
  const width = t === 2 ? w : h;
  const height = t === 2 ? h : w;
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Pixel (x, y), rows from the top, to where the turn takes it.
      const [nx, ny] =
        t === 1
          ? [h - 1 - y, x]
          : t === 2
            ? [w - 1 - x, h - 1 - y]
            : [y, w - 1 - x];
      out[ny * width + nx] = data[y * w + x];
    }
  }
  return { width, height, data: out };
}

/**
 * Where an image `width` × `height` px goes in `box`: fitted as `layout`
 * says, scaled, against the side it's aligned to, then moved by the offset.
 */
export function imagePlacement(
  box: Bounds,
  width: number,
  height: number,
  layout: ImageLayout,
): Bounds {
  const boxWidth = box.maxX - box.minX;
  const boxHeight = box.maxY - box.minY;
  let w = boxWidth;
  let h = boxHeight;
  if (layout.fit !== 'stretch' && width > 0 && height > 0) {
    const scales = [boxWidth / width, boxHeight / height];
    const scale =
      layout.fit === 'cover' ? Math.max(...scales) : Math.min(...scales);
    w = width * scale;
    h = height * scale;
  }
  const scale = layout.scale > 0 ? layout.scale / 100 : 1;
  w *= scale;
  h *= scale;
  const minX =
    layout.alignX === 'left'
      ? box.minX
      : layout.alignX === 'right'
        ? box.maxX - w
        : (box.minX + box.maxX - w) / 2;
  const minY =
    layout.alignY === 'bottom'
      ? box.minY
      : layout.alignY === 'top'
        ? box.maxY - h
        : (box.minY + box.maxY - h) / 2;
  const x = minX + (layout.offsetX || 0);
  const y = minY + (layout.offsetY || 0);
  return { minX: x, maxX: x + w, minY: y, maxY: y + h };
}

/**
 * How deep to carve at `p`: the image's brightness there (bilinear, pixels
 * at their centres) mapped to depth. Outside the image: 0, nothing carved.
 */
export function depthAt(
  image: Brightness,
  p: CamPoint,
  options: Pick<
    EngraveOptions,
    'placement' | 'lightDepth' | 'darkDepth' | 'gamma' | 'invert'
  >,
): number {
  const { placement: box } = options;
  const { width: w, height: h, data } = image;
  if (
    !(w > 0 && h > 0) ||
    p.x < box.minX ||
    p.x > box.maxX ||
    p.y < box.minY ||
    p.y > box.maxY
  ) {
    return 0;
  }
  // Pixel coordinates, rows from the top (Y runs up).
  const u = ((p.x - box.minX) / (box.maxX - box.minX)) * w - 0.5;
  const v = ((box.maxY - p.y) / (box.maxY - box.minY)) * h - 0.5;
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(u)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(v)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, u - x0));
  const fy = Math.min(1, Math.max(0, v - y0));
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  const brightness = Math.min(1, Math.max(0, top * (1 - fy) + bottom * fy));

  const tone = options.invert ? brightness : 1 - brightness;
  const gamma = options.gamma > 0 ? options.gamma : 1;
  return (
    options.lightDepth +
    Math.pow(tone, gamma) * (options.darkDepth - options.lightDepth)
  );
}

/**
 * Raster lines over the area inside `loops` (closed, even-odd), carved as
 * deep as the image is dark. A V-bit's groove widens with depth, so dark
 * areas come out as wide grooves (shadow) and light ones as thin lines or
 * bare surface. Each line is sampled every `sampleStep`, then points the
 * depth runs straight through (within `tolerance`) are dropped. Stretches
 * left at the surface are crossed in the air when long (`LIFT_OVER`).
 */
export function engraveRuns(
  loops: CamPoint[][],
  image: Brightness,
  options: EngraveOptions,
): EngraveRun[] {
  if (
    !loops.length ||
    !(options.spacing > 0) ||
    !(options.sampleStep > 0) ||
    !(options.darkDepth >= 0 && options.lightDepth >= 0)
  ) {
    return [];
  }

  // Work in a frame where the lines run along X.
  const angle = ((options.angle || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toFrame = (p: CamPoint): CamPoint => ({
    x: p.x * cos + p.y * sin,
    y: -p.x * sin + p.y * cos,
  });
  const fromFrame = (p: CamPoint): CamPoint => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  });

  const frameLoops = loops.map((loop) => loop.map(toFrame));
  const lines = rasterLines(frameLoops, 'x', options.spacing);
  const start = toFrame({
    x: options.placement.minX,
    y: options.placement.minY,
  });
  const paths = rasterPaths(lines, frameLoops, 'x', start, options.oneWay);

  const runs: CamPoint3[][] = [];
  for (const path of paths) {
    // Pairs of points: each a stretch along a line (the moves between them
    // step over to the next line).
    for (let i = 0; i + 1 < path.length; i += 2) {
      runs.push(...carveStretch(path[i], path[i + 1]));
    }
  }

  const linked: EngraveRun[] = [];
  let previous: CamPoint3 | null = null;
  for (const points of runs) {
    const first = points[0];
    linked.push({
      points,
      linked:
        !!previous &&
        getDistance(previous, first) <= LIFT_OVER &&
        staysInside(loops, previous, first),
    });
    previous = points[points.length - 1];
  }
  return linked;

  /** The stretch from `a` to `b` (frame), split where it's long at the surface. */
  function carveStretch(a: CamPoint, b: CamPoint): CamPoint3[][] {
    const length = getDistance(a, b);
    const count = Math.max(1, Math.ceil(length / options.sampleStep));
    const step = length / count;
    const samples: CamPoint3[] = [];
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const p = fromFrame({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      samples.push({ ...p, z: -depthAt(image, p, options) });
    }

    // Split off what's at the surface: always at the ends, inside a stretch
    // when it's long enough to be worth lifting over.
    const pieces: CamPoint3[][] = [];
    const longGap = Math.max(1, Math.ceil(LIFT_OVER / Math.max(step, 1e-9)));
    let from = -1;
    let surfaceFrom = 0;
    for (let k = 0; k <= count; k++) {
      const atSurface = samples[k].z > -SURFACE;
      if (atSurface) {
        continue;
      }
      // Into the material: from the last sample at the surface before it.
      const entry = Math.max(0, k - 1);
      if (from < 0) {
        from = entry;
      } else if (entry - surfaceFrom >= longGap) {
        pieces.push(samples.slice(from, surfaceFrom + 1));
        from = entry;
      }
      surfaceFrom = Math.min(count, k + 1);
    }
    if (from >= 0) {
      pieces.push(samples.slice(from, surfaceFrom + 1));
    }
    return pieces.map((piece) => simplifyDepths(piece, options.tolerance));
  }
}

/**
 * Points on a straight line with changing depth, without those the depth
 * runs straight through within `tolerance` (Douglas–Peucker on distance
 * along the line and Z).
 */
export function simplifyDepths(
  points: CamPoint3[],
  tolerance: number,
): CamPoint3[] {
  if (points.length < 3) {
    return points;
  }
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(along[i - 1] + getDistance(points[i - 1], points[i]));
  }
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const span = along[j] - along[i];
    let worst = -1;
    let worstError = tolerance;
    for (let k = i + 1; k < j; k++) {
      const t = span > 0 ? (along[k] - along[i]) / span : 0;
      const z = points[i].z + (points[j].z - points[i].z) * t;
      const error = Math.abs(points[k].z - z);
      if (error > worstError) {
        worst = k;
        worstError = error;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
