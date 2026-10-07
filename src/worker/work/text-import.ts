import type { Font, Glyph } from 'opentype.js';
import { clipperBooleanOperation, makePaths } from '../../cam/clipper';
import { CamPoint, CamShape } from '../../cam/types';
import {
  curveTolerance,
  decimals,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import {
  FontRef,
  fontFileUrl,
  fontUnicodeUrl,
  parseUnicodeRange,
} from '../../cam/font-source';

export type TextParameters = {
  text: string;
  font: FontRef | undefined;
  fontWeight: number;
  fontStyle: string;
  /** Height of capital letters, in mm. */
  size: number;
  /** Extra space between letters, in mm. */
  letterSpacing: number;
  /** Distance between baselines, as a multiple of the font size (em). */
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
};

const CACHE_NAME = 'cnc-utils-fonts';

/**
 * Lay out text in a Google font and return its outlines. The text block
 * starts at x = 0 and the last line's baseline sits on y = 0 (lines stack
 * upwards); alignment happens within the widest line.
 */
export async function importText(
  params: TextParameters,
  sourceShapeId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  const lines = (params.text ?? '').split(/\r?\n/);
  if (!params.font || !(params.size > 0) || !lines.some((l) => l.trim())) {
    return [];
  }

  try {
    const fonts = await loadFontsFor(params, lines.join(''));
    const contours = layout(params, lines, fonts);
    return [{ sourceShapeId, polygons: await unionContours(contours) }];
  } catch (error) {
    // A network hiccup shouldn't break the whole shape pipeline.
    console.warn(`text: could not load font "${params.font.id}"`, error);
    return [];
  }
}

type LoadedFonts = {
  /** The font for the default subset; its metrics drive the layout. */
  primary: Font;
  /** All loaded subset fonts, in lookup order. */
  all: Font[];
};

/**
 * Fontsource splits each font into per-script subset files. Load the default
 * subset plus whichever others the text needs.
 */
async function loadFontsFor(
  params: TextParameters,
  text: string,
): Promise<LoadedFonts> {
  const font = params.font!;
  const ranges = await fetchJson<Record<string, string>>(fontUnicodeUrl(font));

  const subsets = Object.entries(ranges).map(([subset, range]) => ({
    subset,
    ranges: parseUnicodeRange(range),
  }));
  const primarySubset =
    subsets.find((s) => s.subset === 'latin')?.subset ?? subsets[0]?.subset;

  const needed = new Set<string>(primarySubset ? [primarySubset] : []);
  for (const char of new Set(text)) {
    const code = char.codePointAt(0)!;
    const match = subsets.find((s) =>
      s.ranges.some(([start, end]) => code >= start && code <= end),
    );
    if (match) {
      needed.add(match.subset);
    }
  }

  // Loaded on demand so workers that never draw text stay small. The build
  // takes the package's CommonJS "browser" file, whose exports end up on
  // `default`.
  const opentype = await import('opentype.js');
  const parse =
    opentype.parse ??
    (opentype as unknown as { default: typeof opentype }).default.parse;

  const ordered = [...needed];
  const all = await Promise.all(
    ordered.map(async (subset) =>
      parse(
        await fetchBinary(
          fontFileUrl(font, subset, params.fontWeight, params.fontStyle, 'ttf'),
        ),
      ),
    ),
  );

  return { primary: all[0], all };
}

function layout(
  params: TextParameters,
  lines: string[],
  fonts: LoadedFonts,
): CamPoint[][] {
  const { primary } = fonts;
  const unitsPerEm = primary.unitsPerEm;

  // Size the text by its capital height, which is what people measure.
  const capHeightUnits =
    (primary.tables['os2'] as any)?.sCapHeight ||
    primary.charToGlyph('H')?.getBoundingBox()?.y2 ||
    unitsPerEm * 0.7;
  const emSize = (params.size * unitsPerEm) / capHeightUnits;
  const scale = emSize / unitsPerEm;
  const lineHeight = emSize * (params.lineSpacing || 1.2);

  type Placed = { glyph: Glyph; x: number };
  const laidOut = lines.map((line) => {
    const placed: Placed[] = [];
    let x = 0;
    let previous: { glyph: Glyph; font: Font } | null = null;

    for (const char of line) {
      const { glyph, font } = findGlyph(fonts, char);
      if (previous && previous.font === font) {
        x += font.getKerningValue(previous.glyph, glyph) * scale;
      }
      placed.push({ glyph, x });
      x += (glyph.advanceWidth ?? 0) * scale + (params.letterSpacing || 0);
      previous = { glyph, font };
    }

    const width = placed.length ? x - (params.letterSpacing || 0) : 0;
    return { placed, width };
  });

  const blockWidth = Math.max(...laidOut.map((l) => l.width));
  const contours: CamPoint[][] = [];

  laidOut.forEach(({ placed, width }, index) => {
    const baseline = (laidOut.length - 1 - index) * lineHeight;
    const offset =
      params.align === 'center'
        ? (blockWidth - width) / 2
        : params.align === 'right'
          ? blockWidth - width
          : 0;

    for (const { glyph, x } of placed) {
      // getPath is y-down around the baseline; flip into the y-up world.
      const path = glyph.getPath(offset + x, 0, emSize);
      contours.push(
        ...flatten(path.commands).map((contour) =>
          contour.map((p) => ({ x: p.x, y: baseline - p.y })),
        ),
      );
    }
  });

  return contours;
}

function findGlyph(fonts: LoadedFonts, char: string) {
  for (const font of fonts.all) {
    const glyph = font.charToGlyph(char);
    if (glyph && glyph.index !== 0) {
      return { glyph, font };
    }
  }
  // Not in any loaded subset: fall back to the .notdef box so it's visible.
  return { glyph: fonts.primary.charToGlyph(char), font: fonts.primary };
}

/** Turn path commands into closed polylines, flattening curves adaptively. */
function flatten(commands: any[]): CamPoint[][] {
  const contours: CamPoint[][] = [];
  let current: CamPoint[] = [];
  let pen: CamPoint = { x: 0, y: 0 };

  const close = () => {
    if (current.length > 2) {
      contours.push(current);
    }
    current = [];
  };

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        pen = { x: c.x, y: c.y };
        current.push(pen);
        break;
      case 'L':
        pen = { x: c.x, y: c.y };
        current.push(pen);
        break;
      case 'Q': {
        const p1 = { x: c.x1, y: c.y1 };
        const p2 = { x: c.x, y: c.y };
        const d = deviation(pen, p1, p2);
        const n = Math.max(1, Math.ceil(Math.sqrt(d / (4 * curveTolerance()))));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          current.push({
            x: u * u * pen.x + 2 * u * t * p1.x + t * t * p2.x,
            y: u * u * pen.y + 2 * u * t * p1.y + t * t * p2.y,
          });
        }
        pen = p2;
        break;
      }
      case 'C': {
        const p1 = { x: c.x1, y: c.y1 };
        const p2 = { x: c.x2, y: c.y2 };
        const p3 = { x: c.x, y: c.y };
        const d = Math.max(deviation(pen, p1, p2), deviation(p1, p2, p3));
        const n = Math.max(
          1,
          Math.ceil(Math.sqrt((3 * d) / (4 * curveTolerance()))),
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          current.push({
            x:
              u * u * u * pen.x +
              3 * u * u * t * p1.x +
              3 * u * t * t * p2.x +
              t * t * t * p3.x,
            y:
              u * u * u * pen.y +
              3 * u * u * t * p1.y +
              3 * u * t * t * p2.y +
              t * t * t * p3.y,
          });
        }
        pen = p3;
        break;
      }
      case 'Z':
        close();
        break;
    }
  }
  close();

  return contours;
}

/** |a - 2b + c|: how far a curve bends away from its chord. */
function deviation(a: CamPoint, b: CamPoint, c: CamPoint) {
  return Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y);
}

/**
 * Many Google fonts are drawn with overlapping contours (and tight letter
 * spacing makes neighbours touch). A non-zero union merges those into clean
 * outlines with proper holes.
 */
async function unionContours(contours: CamPoint[][]) {
  if (!contours.length) {
    return [];
  }
  const paths = await makePaths(contours);
  const empty = await makePaths([]);
  const result = await clipperBooleanOperation(
    paths,
    empty,
    'union',
    'non-zero',
    decimals(),
  );
  paths.delete();
  empty.delete();

  const polygons = [];
  const size = result.size();
  for (let i = 0; i < size; i++) {
    const path = result.get(i);
    const points: CamPoint[] = [];
    for (let j = 0; j < path.size(); j++) {
      const point = path.get(j);
      points.push({ x: point.x, y: point.y });
    }
    polygons.push({ points, close: true });
  }
  result.delete();

  return polygons;
}

const jsonCache = new Map<string, Promise<any>>();

function fetchJson<T>(url: string): Promise<T> {
  if (!jsonCache.has(url)) {
    const request = fetchCached(url).then((r) => r.json());
    request.catch(() => jsonCache.delete(url));
    jsonCache.set(url, request);
  }
  return jsonCache.get(url)!;
}

const binaryCache = new Map<string, Promise<ArrayBuffer>>();

function fetchBinary(url: string): Promise<ArrayBuffer> {
  if (!binaryCache.has(url)) {
    const request = fetchCached(url).then((r) => r.arrayBuffer());
    request.catch(() => binaryCache.delete(url));
    binaryCache.set(url, request);
  }
  return binaryCache.get(url)!;
}

/**
 * Version-pinned font URLs never change, so keep them in the Cache Storage:
 * workers are recycled, and this also lets known fonts work offline.
 */
async function fetchCached(url: string): Promise<Response> {
  const cache =
    typeof caches !== 'undefined'
      ? await caches.open(CACHE_NAME).catch(() => null)
      : null;

  const cached = await cache?.match(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  await cache?.put(url, response.clone()).catch(() => {});
  return response;
}
