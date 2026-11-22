import { Color } from 'three';

/**
 * The preview's colours for a theme: what's drawn in the scene (the HUD's
 * and the tools' are CSS variables in the viewer's stylesheet).
 */
export type PreviewPalette = {
  background: Color;
  grid: { minor: Color; major: Color; xAxis: Color; yAxis: Color };
  /** Shape outlines and fills; `shapeOpacity` for those not highlighted. */
  shape: Color;
  shapeOpacity: number;
  stock: Color;
  tab: Color;
  clamp: Color;
  travel: Color;
  measure: Color;
  /** The points a shape is reshaped by. */
  handles: { point: Color; control: Color; locked: Color };
  /** The G-code lines selected beside the preview, and the bit's tip. */
  gcode: { line: Color; tip: Color };
  /** Cuts by depth, surface → deepest, as CSS colours. */
  depthStops: string[];
  /** Cuts by feed, slowest → fastest. */
  feedStops: string[];
};

const DARK: PreviewPalette = {
  background: new Color('#000000'),
  grid: {
    minor: new Color(0x262626),
    major: new Color(0x4a4a4a),
    xAxis: new Color(0x8a3030),
    yAxis: new Color(0x2f7a2f),
  },
  shape: new Color('orange'),
  shapeOpacity: 0.2,
  stock: new Color('#c9a227'),
  tab: new Color('#4dd0e1'),
  clamp: new Color('#ef4444'),
  travel: new Color('salmon'),
  measure: new Color('#ffd54f'),
  handles: {
    point: new Color('#4fc3f7'),
    control: new Color('#ffb74d'),
    locked: new Color('#8a8f98'),
  },
  gcode: { line: new Color('#ffffff'), tip: new Color('#ffd54f') },
  // Pale cyan, blue, magenta.
  depthStops: ['#b3f0ff', '#2f80ed', '#e040fb'],
  // Red, amber, green.
  feedStops: ['#ef5350', '#ffca28', '#66bb6a'],
};

/** The same hues, dark enough to read on a light background. */
const LIGHT: PreviewPalette = {
  background: new Color('#f6f7f9'),
  grid: {
    minor: new Color('#e4e7ec'),
    major: new Color('#c3c8d1'),
    xAxis: new Color('#e29a9a'),
    yAxis: new Color('#8fcb8f'),
  },
  shape: new Color('#d9690f'),
  shapeOpacity: 0.25,
  stock: new Color('#8a6a00'),
  tab: new Color('#0e96ab'),
  clamp: new Color('#dc2626'),
  travel: new Color('#e0533a'),
  measure: new Color('#b45309'),
  handles: {
    point: new Color('#0284c7'),
    control: new Color('#d97706'),
    locked: new Color('#7b8494'),
  },
  gcode: { line: new Color('#111827'), tip: new Color('#f59e0b') },
  depthStops: ['#5cc8f0', '#1d5fd6', '#c026d3'],
  feedStops: ['#dc2626', '#d99a06', '#16a34a'],
};

export function previewPalette(dark: boolean): PreviewPalette {
  return dark ? DARK : LIGHT;
}

/** The dark theme's depth colours: what the simulated material's cuts take. */
export const DEPTH_STOPS = DARK.depthStops;
