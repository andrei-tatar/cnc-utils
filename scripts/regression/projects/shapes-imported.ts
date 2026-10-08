import { Fixture, project } from './fixture';
import {
  endMill2,
  endMill6,
  pocket,
  profile,
  roboto,
  shape,
  tf,
} from './parts';

/**
 * Primitives an SVG file may hold: a rounded rect, a circle, an ellipse, a
 * path with an arc, a path whose hole is wound the same way (even-odd), a
 * path whose hole is wound the other way (non-zero), a polygon, and open
 * lines in a transformed group.
 */
const SVG_PRIMITIVES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">
  <rect x="0" y="0" width="30" height="20" rx="3"/>
  <circle cx="50" cy="10" r="10"/>
  <ellipse cx="85" cy="10" rx="15" ry="8"/>
  <path d="M 0 30 h 30 a 10 10 0 0 1 0 20 h -30 z"/>
  <path fill-rule="evenodd" d="M 45 30 h 30 v 30 h -30 z M 52 37 h 16 v 16 h -16 z"/>
  <path d="M 85 30 h 30 v 30 h -30 z M 92 37 v 16 h 16 v -16 z"/>
  <polygon points="0,65 25,70 15,95 -5,90"/>
  <g transform="translate(40 70) rotate(10)">
    <polyline points="0,0 10,5 20,0 30,5" fill="none" stroke="black"/>
    <line x1="35" y1="0" x2="55" y2="10" stroke="black"/>
  </g>
</svg>`;

/** A star scaled by its viewBox into a document sized in mm. */
const SVG_VIEWBOX = `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 100 100">
  <polygon points="50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35"/>
  <circle cx="50" cy="50" r="8" transform="scale(1.5 1)"/>
</svg>`;

/** A 24 × 24 px greyscale PNG: a black ring (radius 4–10 px) on white. */
export const RING_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAAAAADFHGIkAAAASklEQVR4nLWSORIAIAgD9/+f1hkKJWo8ClMBW0AAihFnQGgCNAlA1AHMZAvGepAEioRIPSWMBn6CRXM7rjf4viu/dn+ozWnvv6QCSgw22Fy0m7oAAAAASUVORK5CYII=';

const text = (
  value: string,
  fontWeight: number,
  fontStyle: 'normal' | 'italic',
  align: 'left' | 'center' | 'right',
  extra: { size?: number; letterSpacing?: number; lineSpacing?: number } = {},
) =>
  ({
    type: 'text',
    text: value,
    font: roboto,
    fontWeight,
    fontStyle,
    size: extra.size ?? 15,
    letterSpacing: extra.letterSpacing ?? 0,
    lineSpacing: extra.lineSpacing ?? 1.2,
    align,
  }) as const;

const trace = (invert: boolean) =>
  ({
    type: 'trace',
    image: RING_PNG,
    fileName: 'ring.png',
    traceThreshold: 128,
    traceInvert: invert,
    traceWidth: 30,
    traceMinArea: 1,
    traceSmoothing: 0.05,
  }) as const;

export default [
  {
    name: 'shape-svg',
    covers:
      'svg shape (raw SVG text): rect with rx, circle, ellipse, path with arc, even-odd and non-zero holes, polygon, open polyline and line in a transformed group; outside profile and pocket',
    model: project({
      shapes: [
        shape('svg', {
          type: 'svg',
          svg: SVG_PRIMITIVES,
          fileName: 'primitives.svg',
        }),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'svg'), pocket('op-pocket', 'svg')],
    }),
  },
  {
    name: 'shape-svg-viewbox',
    covers:
      'svg shape with mm width/height and a viewBox (unit scaling), a concave star polygon and a scaled circle; outside profile and pocket',
    model: project({
      shapes: [
        shape('svg', { type: 'svg', svg: SVG_VIEWBOX, fileName: 'star.svg' }),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'svg'), pocket('op-pocket', 'svg')],
    }),
  },
  {
    name: 'shape-text-regular',
    covers:
      'text shape, Roboto 400 normal, one line "Be8" (letters with holes), left aligned; outside profile (6 mm) and pocket (2 mm)',
    model: project({
      shapes: [shape('text', text('Be8', 400, 'normal', 'left'))],
      tools: [endMill6, endMill2],
      operations: [
        profile('op-profile', 'text'),
        pocket('op-pocket', 'text', { depth: 2, steps: 1 }, endMill2.id),
      ],
    }),
  },
  {
    name: 'shape-text-bold-multiline-center',
    covers:
      'text shape, Roboto 800 normal, two lines "eB8" / "Hope", centred, cap height 20; outside profile (6 mm) and pocket (2 mm)',
    model: project({
      shapes: [
        shape('text', text('eB8\nHope', 800, 'normal', 'center', { size: 20 })),
      ],
      tools: [endMill6, endMill2],
      operations: [
        profile('op-profile', 'text'),
        pocket('op-pocket', 'text', { depth: 2, steps: 1 }, endMill2.id),
      ],
    }),
  },
  {
    name: 'shape-text-italic-right',
    covers:
      'text shape, Roboto 400 italic, three lines right aligned, letter spacing 1, line spacing 1.5; outside profile (6 mm) and inside profile (2 mm)',
    model: project({
      shapes: [
        shape(
          'text',
          text('ego\nAbe 8\nQ', 400, 'italic', 'right', {
            letterSpacing: 1,
            lineSpacing: 1.5,
          }),
        ),
      ],
      tools: [endMill6, endMill2],
      operations: [
        profile('op-outside', 'text'),
        profile('op-inside', 'text', { side: 'inside', depth: 1 }, endMill2.id),
      ],
    }),
  },
  {
    name: 'shape-text-bold-italic',
    covers:
      'text shape, Roboto 800 italic "B8e", negative letter spacing (-0.5, touching glyphs), left; outside profile (6 mm) and pocket (2 mm)',
    model: project({
      shapes: [
        shape(
          'text',
          text('B8e', 800, 'italic', 'left', { letterSpacing: -0.5 }),
        ),
      ],
      tools: [endMill6, endMill2],
      operations: [
        profile('op-profile', 'text'),
        pocket('op-pocket', 'text', { depth: 2, steps: 1 }, endMill2.id),
      ],
    }),
  },
  {
    name: 'shape-trace',
    covers:
      'trace shape: a 24 px PNG ring (data URL) traced dark areas, 30 mm wide, threshold 128 (outline with a hole); outside profile and pocket',
    model: project({
      shapes: [shape('trace', trace(false))],
      tools: [endMill6],
      operations: [
        profile('op-profile', 'trace'),
        pocket('op-pocket', 'trace'),
      ],
    }),
  },
  {
    name: 'shape-trace-invert',
    covers:
      'trace shape with traceInvert (the light areas: background square with a ring-shaped hole, and the centre disc), simplified; inside profile',
    model: project({
      shapes: [
        shape('trace', trace(true), [
          tf('t-simplify', { type: 'simplify', simplifyTolerance: 0.2 }),
        ]),
      ],
      tools: [endMill6],
      operations: [profile('op-profile', 'trace', { side: 'inside' })],
    }),
  },
] satisfies Fixture[];
