import { ShapeParameters } from '../model-editor/model';

/** Shapes that aren't built from another shape or a font. */
export type SvgShapeParameters = Exclude<
  ShapeParameters,
  { type: 'boolean' | 'text' | 'copy' }
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
    default:
      return `<svg></svg>`;
  }
}
