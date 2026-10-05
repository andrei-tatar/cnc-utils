/**
 * Google Fonts, served through Fontsource (https://fontsource.org), which
 * repackages the whole catalog with open CORS: a JSON catalog, per-font
 * metadata, and per-subset TTF/WOFF2 files on jsDelivr. Font files are pinned
 * to a package version so a saved project keeps producing the same outlines.
 */

export type FontCategory =
  | 'sans-serif'
  | 'serif'
  | 'display'
  | 'handwriting'
  | 'monospace'
  | string;

export type FontCatalogEntry = {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  category: FontCategory;
  type: string;
};

/** What a text shape stores about its font. */
export type FontRef = {
  id: string;
  family: string;
  version: string;
  weights: number[];
  styles: string[];
};

export const DEFAULT_FONT: FontRef = {
  id: 'roboto',
  family: 'Roboto',
  version: '5.2.10',
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ['italic', 'normal'],
};

export const FONT_CATALOG_URL = 'https://api.fontsource.org/v1/fonts';

export const fontInfoUrl = (id: string) =>
  `https://api.fontsource.org/v1/fonts/${encodeURIComponent(id)}`;

/** Which code points each subset file covers, e.g. "U+0000-00FF,U+0131". */
export const fontUnicodeUrl = (font: FontRef) =>
  `https://cdn.jsdelivr.net/npm/@fontsource/${font.id}@${font.version}/unicode.json`;

export const fontFileUrl = (
  font: Pick<FontRef, 'id'> & { version?: string },
  subset: string,
  weight: number,
  style: string,
  format: 'ttf' | 'woff2',
) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@${
    font.version ?? 'latest'
  }/${subset}-${weight}-${style}.${format}`;

/** Parse a CSS unicode-range ("U+0000-00FF,U+0131") into [start, end] pairs. */
export function parseUnicodeRange(range: string): Array<[number, number]> {
  return range
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part) => {
      const [start, end] = part.split('-').map((v) => parseInt(v, 16));
      return [start, Number.isNaN(end) || end === undefined ? start : end];
    });
}

/** The supported weight closest to `weight` (ties go to the heavier one). */
export function nearestWeight(weights: number[], weight: number): number {
  return weights.reduce(
    (best, w) =>
      Math.abs(w - weight) < Math.abs(best - weight) ||
      (Math.abs(w - weight) === Math.abs(best - weight) && w > best)
        ? w
        : best,
    weights[0] ?? 400,
  );
}
