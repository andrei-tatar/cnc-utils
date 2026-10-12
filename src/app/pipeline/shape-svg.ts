import { boxPanelOutline, mortiseRects } from '../../cam/box-joints';
import { bowtieOutline } from '../../cam/hinge-cup';
import { pathCommandsData } from '../../cam/path-commands';
import { finitePoints, pathData } from '../../cam/point-patterns';
import { ShapeParameters } from '../model-editor/model';

/**
 * Shapes that aren't built from another shape, a font, an image, or as
 * points.
 */
export type SvgShapeParameters = Exclude<
  ShapeParameters,
  {
    type:
      | 'boolean'
      | 'text'
      | 'copy'
      | 'points'
      | 'trace'
      | 'hinge-cup'
      | 'nest'
      | 'nest-layer';
  }
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
      return `<svg><path d="${pathCommandsData(t.pathCommands)}" /></svg>`;
    case 'slot': {
      const width = Math.max(0, t.slotWidth);
      const length = Math.max(width, t.slotLength);
      return `<svg><rect x="${-length / 2}" y="${-width / 2}" width="${length}" height="${width}" rx="${width / 2}"/></svg>`;
    }
    case 'polyline':
      return `<svg><path d="${pathData(
        finitePoints(t.polylinePoints),
        t.polylineClosed,
      )}" /></svg>`;
    case 'bowtie':
      return `<svg><path d="${pathData(
        bowtieOutline(t.bowtieLength, t.bowtieEndWidth, t.bowtieWaist),
        true,
      )}" /></svg>`;
    case 'mortises':
      return `<svg>${mortiseRects(
        t.mortiseLength,
        {
          count: t.mortiseCount,
          width: t.mortiseWidth,
          margin: t.mortiseMargin,
        },
        t.mortiseThickness,
        t.mortisePlay ?? 0,
      )
        .map((rect) => `<path d="${pathData(rect, true)}" />`)
        .join('')}</svg>`;
    case 'dado': {
      const open = t.dadoEnds ?? 'both';
      const run = Math.max(0, t.dadoOverrun ?? 0);
      const from = open === 'start' || open === 'both' ? -run : 0;
      const to =
        Math.max(0, t.dadoLength) +
        (open === 'end' || open === 'both' ? run : 0);
      const half =
        (Math.max(0, t.dadoThickness) + Math.max(0, t.dadoPlay ?? 0)) / 2;
      return `<svg><rect x="${from}" y="${-half}" width="${to - from}" height="${2 * half}"/></svg>`;
    }
    case 'box-panel':
      return `<svg><path d="${pathData(
        boxPanelOutline({
          width: t.boxWidth,
          height: t.boxHeight,
          thickness: t.boxThickness,
          fingerWidth: t.boxFingerWidth,
          play: t.boxPlay,
          edges: [t.boxBottom, t.boxRight, t.boxTop, t.boxLeft],
          tenons: {
            count: t.boxTenonCount ?? 2,
            width: t.boxTenonWidth ?? 20,
            margin: t.boxTenonMargin ?? 15,
          },
          dovetails: {
            count: t.boxDovetailCount ?? 3,
            angle: t.boxDovetailAngle ?? 10,
          },
        }),
        true,
      )}" /></svg>`;
    default:
      return `<svg></svg>`;
  }
}
