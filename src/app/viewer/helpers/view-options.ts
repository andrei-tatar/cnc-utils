import { Color } from 'three';
import { DEFAULT_MATERIAL } from '../../../cam/feeds-speeds';
import { DEPTH_STOPS } from './path-colors';
import type { StockColors } from './stock-solid';

/** How each material looks (its colour freshly cut), by id in `MATERIALS`. */
const MATERIAL_COLORS: Record<string, string> = {
  cedar: '#c98b5a',
  spruce: '#ead7b0',
  fir: '#e2c595',
  pine: '#e9cf9a',
  larch: '#d9a86c',
  linden: '#efe0c0',
  poplar: '#ddd2a6',
  alder: '#d9a679',
  elm: '#c99a6b',
  cherry: '#b8714a',
  walnut: '#6e4a33',
  birch: '#ecd8b0',
  oak: '#d8b583',
  ash: '#e3cfa4',
  beech: '#e0b98c',
  maple: '#efdcb8',
  acacia: '#c79a52',
  hornbeam: '#ebe0c8',
  hickory: '#d5b384',
  mahogany: '#9a4e32',
  teak: '#b8864b',
  sapele: '#94503a',
  wenge: '#4b3527',
  zebrawood: '#d8bf8a',
  padauk: '#b8452a',
  purpleheart: '#7d3c5e',
  ipe: '#6b4a2e',
  mdf: '#b49b77',
  plywood: '#e6cc9c',
  'acrylic-cast': '#dce9ef',
  'acrylic-extruded': '#dce9ef',
  polycarbonate: '#d6e1e6',
  petg: '#d9e8e4',
  abs: '#ebe5d3',
  pvc: '#8f949a',
  'pvc-foam': '#f4f4f1',
  hdpe: '#f1f1ec',
  uhmw: '#efefe9',
  polypropylene: '#eeece4',
  acetal: '#f1efe6',
  nylon: '#ede4c9',
  'al-6060': '#cfd2d6',
  'al-6061': '#c8cbd0',
  'al-5083-cast': '#d2d5d8',
  'al-7075': '#c1c4c9',
};

/**
 * The simulated material's colours for a material (an id in `MATERIALS`):
 * its own colour on the uncut faces, darker on the sides and darker still
 * at the deepest cuts.
 */
export function materialColors(materialId: string): StockColors {
  const base = new Color(
    MATERIAL_COLORS[materialId] ?? MATERIAL_COLORS[DEFAULT_MATERIAL],
  );
  return {
    top: base.clone(),
    side: base.clone().multiplyScalar(0.8),
    floor: base.clone().multiplyScalar(0.4),
  };
}

/**
 * What the simulated material can look like: the stock's own colour, or, to
 * make the details stand out, a neutral grey (its shape shown by the light
 * alone) or the cuts coloured by depth, as the toolpaths are.
 */
export const PREVIEW_MATERIALS = [
  { id: 'stock', name: 'the stock’s material' },
  { id: 'clay', name: 'grey clay' },
  { id: 'depth', name: 'depth colours' },
] as const;

export type PreviewMaterial = (typeof PREVIEW_MATERIALS)[number]['id'];

/** The simulated material's colours, for `materialId` the stock's. */
export function previewColors(
  material: PreviewMaterial,
  materialId: string,
): StockColors {
  switch (material) {
    case 'clay':
      return {
        top: new Color('#d6d6d6'),
        side: new Color('#b4b4b4'),
        floor: new Color('#5c5c5c'),
      };
    case 'depth':
      return {
        top: new Color('#cfcfcf'),
        side: new Color('#a8a8a8'),
        floor: new Color('#cfcfcf'),
        depthRamp: DEPTH_STOPS.map((hex) => new Color(hex)),
      };
    default:
      return materialColors(materialId);
  }
}

/** What the preview shows, as picked in its view options. */
export type ViewOptions = {
  grid: boolean;
  gridLabels: boolean;
  /** What the simulated material looks like. */
  material: PreviewMaterial;
};

const DEFAULTS: ViewOptions = {
  grid: true,
  gridLabels: true,
  material: 'depth',
};
const STORAGE_KEY = 'ui.viewOptions';

/** The view options last picked in this browser (the defaults at first). */
export function loadViewOptions(): ViewOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      grid: typeof stored.grid === 'boolean' ? stored.grid : DEFAULTS.grid,
      gridLabels:
        typeof stored.gridLabels === 'boolean'
          ? stored.gridLabels
          : DEFAULTS.gridLabels,
      material: PREVIEW_MATERIALS.some((m) => m.id === stored.material)
        ? stored.material
        : DEFAULTS.material,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveViewOptions(options: ViewOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage unavailable: they're only kept for this page load.
  }
}
