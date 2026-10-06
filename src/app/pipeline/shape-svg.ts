import { boxPanelOutline } from '../../cam/box-joints';
import { parsePointList, pathData } from '../../cam/point-patterns';
import { ShapeParameters } from '../model-editor/model';

/**
 * Shapes that aren't built from another shape, a font, an image, or as
 * points.
 */
export type SvgShapeParameters = Exclude<
  ShapeParameters,
  { type: 'boolean' | 'text' | 'copy' | 'points' | 'trace' }
>;

/** The shape as an SVG document, for the worker's `importSvg`. */
export function createSvgFromShape(t: SvgShapeParameters) {
  switch (t.type) {
    case 'circle':
      return `<svg><circle r="${t.diameter / 2}"/></svg>`;
    case 'rectangle':
      return `<svg><rect width="${t.width}" height="${t.height}" rx="${t.radius}"/></svg>`;
    case 'svg':
      return t.svg ?? `<svg></svg>`;
    case 'line':
      return `<svg><line x1="0" y1="0" x2="${t.width}" y2="0" /></svg>`;
    case 'path-data':
      return `<svg><path d="${t.data}" /></svg>`;
    case 'slot': {
      const width = Math.max(0, t.slotWidth);
      const length = Math.max(width, t.slotLength);
      return `<svg><rect x="${-length / 2}" y="${-width / 2}" width="${length}" height="${width}" rx="${width / 2}"/></svg>`;
    }
    case 'polyline':
      return `<svg><path d="${pathData(
        parsePointList(t.polylinePoints),
        t.polylineClosed,
      )}" /></svg>`;
    case 'box-panel':
      return `<svg><path d="${pathData(
        boxPanelOutline({
          width: t.boxWidth,
          height: t.boxHeight,
          thickness: t.boxThickness,
          fingerWidth: t.boxFingerWidth,
          play: t.boxPlay,
          edges: [t.boxBottom, t.boxRight, t.boxTop, t.boxLeft],
        }),
        true,
      )}" /></svg>`;
    default:
      return `<svg></svg>`;
  }
}
