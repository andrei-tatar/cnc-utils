import type { Font, Glyph } from 'opentype.js';
import { CamPoint, CamPolygon, CamShape, CamVertex } from '../../cam/types';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import { cubic, fitBiarcs, quadratic } from '../../cam/biarc';
import { normalize } from '../../cam/kernel';
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
): CamPolygon[] {
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
  const contours: CamPolygon[] = [];

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
        ...outlines(path.commands, (x, y) => ({ x, y: baseline - y })),
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

/**
 * Path commands as closed outlines of lines and arcs, curves fitted with
 * arcs within the curve tolerance. `at` maps the commands' coordinates.
 */
function outlines(
  commands: any[],
  at: (x: number, y: number) => CamPoint,
): CamPolygon[] {
  const contours: CamPolygon[] = [];
  let vertices: CamVertex[] = [];
  let start: CamPoint = { x: 0, y: 0 };
  let pen: CamPoint = { x: 0, y: 0 };
  const tolerance = curveTolerance();

  const close = () => {
    // Back to the start in a line, unless the last segment got there.
    if (
      vertices.length &&
      Math.hypot(pen.x - start.x, pen.y - start.y) > 1e-9
    ) {
      vertices.push({ x: pen.x, y: pen.y });
    }
    if (
      vertices.length > 2 ||
      (vertices.length > 1 && vertices.some((v) => v.bulge))
    ) {
      contours.push({ vertices, close: true });
    }
    vertices = [];
  };

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        start = pen = at(c.x, c.y);
        break;
      case 'L': {
        const to = at(c.x, c.y);
        if (Math.hypot(to.x - pen.x, to.y - pen.y) > 1e-9) {
          vertices.push({ x: pen.x, y: pen.y });
        }
        pen = to;
        break;
      }
      case 'Q': {
        const to = at(c.x, c.y);
        vertices.push(
          ...fitBiarcs(quadratic(pen, at(c.x1, c.y1), to), tolerance),
        );
        pen = to;
        break;
      }
      case 'C': {
        const to = at(c.x, c.y);
        vertices.push(
          ...fitBiarcs(
            cubic(pen, at(c.x1, c.y1), at(c.x2, c.y2), to),
            tolerance,
          ),
        );
        pen = to;
        break;
      }
      case 'Z':
        close();
        pen = start;
        break;
    }
  }
  close();

  return contours;
}

/**
 * Many Google fonts are drawn with overlapping contours (and tight letter
 * spacing makes neighbours touch). A non-zero union merges those into clean
 * outlines with proper holes.
 */
async function unionContours(contours: CamPolygon[]): Promise<CamPolygon[]> {
  if (!contours.length) {
    return [];
  }
  return normalize(contours, 'non-zero');
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
