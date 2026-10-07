import { Fixture, project } from './fixture';
import {
  flatPlug,
  inlayPlug,
  L_SHAPE,
  pocket,
  polyline,
  rect,
  star,
  text,
  tool,
  vBit,
  vCarve,
  vCarveClear,
} from './operations-parts';

// Inlays: V-carved plugs (inlay-plug, borrowing the female v-carve), their
// clearings, and flat-bottomed plugs (flat-plug, borrowing a pocket).

const v60 = vBit('t-v60', 1, 6.35, 60);
const v90 = vBit('t-v90', 2, 12, 90);
const em3 = tool('t-em3', 3, 'end-mill', 3);
const em6 = tool('t-em6', 4, 'end-mill', 6);

const STAR = polyline('s-star', star(30, 30, 25, 11), true);
const B_TEXT = text('s-text', 'B', 30, 800);

export default [
  {
    name: 'inlay-plug-basic',
    covers:
      'inlay-plug from a v-carve pocket (maxDepth 3, stepover 0.5): inlayGap 0.5, inlayAbove 1.5, inlayMargin 5',
    model: project({
      shapes: [STAR],
      tools: [v90],
      operations: [
        vCarve('o-pocket', 't-v90', 's-star', { maxDepth: 3, stepover: 0.5 }),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket'),
      ],
    }),
  },
  {
    name: 'inlay-plug-no-gap-small-margin',
    covers:
      'inlay-plug, inlayGap 0, inlayAbove 0.5, inlayMargin 2, 60° bit, text "B" weight 800',
    model: project({
      shapes: [B_TEXT],
      tools: [v60],
      operations: [
        vCarve('o-pocket', 't-v60', 's-text', { maxDepth: 2, stepover: 0.3 }),
        inlayPlug('o-plug', 't-v60', 's-text', 'o-pocket', {
          inlayGap: 0,
          inlayAbove: 0.5,
          inlayMargin: 2,
        }),
      ],
    }),
  },
  {
    name: 'inlay-plug-deep-gap-large-margin',
    covers:
      'inlay-plug, inlayGap 1, inlayAbove 3, inlayMargin 10, pocket single pass with centre line settings borrowed',
    model: project({
      shapes: [STAR],
      tools: [v90],
      operations: [
        vCarve('o-pocket', 't-v90', 's-star', {
          maxDepth: 4,
          stepover: null,
          sharpCornerAngle: 120,
        }),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket', {
          inlayGap: 1,
          inlayAbove: 3,
          inlayMargin: 10,
        }),
      ],
    }),
  },
  {
    name: 'inlay-plug-borrowed-options',
    covers:
      'inlay-plug borrowing centerLine on and sharpCorners off from its v-carve, different V-bit than the pocket',
    model: project({
      shapes: [STAR],
      tools: [v60, v90],
      operations: [
        vCarve('o-pocket', 't-v60', 's-star', {
          maxDepth: 2.5,
          stepover: 0.4,
          centerLine: true,
          sharpCorners: false,
        }),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket'),
      ],
    }),
  },
  {
    name: 'inlay-plug-with-clearing',
    covers:
      'v-carve-clear (6 mm end mill) for the inlay-plug, listed before it: plug clearing round the design, plug beyondCone',
    model: project({
      shapes: [STAR],
      tools: [v90, em6],
      operations: [
        vCarve('o-pocket', 't-v90', 's-star', { maxDepth: 3, stepover: 0.5 }),
        vCarveClear('o-clear', 't-em6', 's-star', 'o-plug', {
          depthPerStep: 1.5,
          leaveStock: 0.2,
          toolEngagement: 0.5,
        }),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket', { inlayAbove: 2 }),
      ],
    }),
  },
  {
    name: 'inlay-pocket-and-plug-cleared',
    covers:
      'female v-carve with its own clearing (beyond cone) and plug with its clearing (3 mm, ramp) before each',
    model: project({
      shapes: [B_TEXT],
      tools: [
        v60,
        em3,
        tool('t-em3r', 5, 'end-mill', 3, { ramp: true, rampAngle: 5 }),
      ],
      operations: [
        vCarveClear('o-clear-pocket', 't-em3', 's-text', 'o-pocket'),
        vCarve('o-pocket', 't-v60', 's-text', { maxDepth: 6, stepover: 0.4 }),
        vCarveClear('o-clear-plug', 't-em3r', 's-text', 'o-plug', {
          leaveStock: 0.1,
        }),
        inlayPlug('o-plug', 't-v60', 's-text', 'o-pocket', { inlayMargin: 4 }),
      ],
    }),
  },
  {
    name: 'inlay-plug-unlimited-source',
    covers:
      'inlay-plug referencing an unlimited-depth v-carve (no plug source: plug routes nothing), and its clearing too',
    model: project({
      shapes: [STAR],
      tools: [v90, em6],
      operations: [
        vCarve('o-pocket', 't-v90', 's-star', {
          unlimitedDepth: true,
          stepover: 0.5,
        }),
        vCarveClear('o-clear', 't-em6', 's-star', 'o-plug'),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket'),
      ],
    }),
  },
  {
    name: 'inlay-plug-ramp',
    covers:
      'inlay-plug with rampMode ramp (angle 6), pocket v-carve with startDepth 0.5',
    model: project({
      shapes: [STAR],
      tools: [v90],
      operations: [
        vCarve('o-pocket', 't-v90', 's-star', {
          startDepth: 0.5,
          maxDepth: 3,
          stepover: 0.5,
        }),
        inlayPlug('o-plug', 't-v90', 's-star', 'o-pocket', {
          rampMode: 'ramp',
          rampAngle: 6,
        }),
      ],
    }),
  },
  {
    name: 'flat-plug-basic',
    covers:
      'flat-plug for an offset pocket (6 mm bit rounds its corners), 3 mm bit, inlayGap 0.1, no mirror, climb, 2 × 2 mm',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6, em3],
      operations: [
        pocket('o-pocket', 't-em6', 's-l', { depth: 2, steps: 2 }),
        flatPlug('o-plug', 't-em3', 's-l', 'o-pocket'),
      ],
    }),
  },
  {
    name: 'flat-plug-mirror-conventional',
    covers:
      'flat-plug, plugMirror on, conventional, inlayGap 0.25, depthMode total 5 ÷ 2, startDepth 0.5',
    model: project({
      shapes: [polyline('s-l', L_SHAPE, true)],
      tools: [em6, em3],
      operations: [
        pocket('o-pocket', 't-em6', 's-l', { depth: 4 }),
        flatPlug('o-plug', 't-em3', 's-l', 'o-pocket', {
          plugMirror: true,
          direction: 'conventional',
          inlayGap: 0.25,
          startDepth: 0.5,
          depthMode: 'total',
          depth: 5,
          steps: 2,
        }),
      ],
    }),
  },
  {
    name: 'flat-plug-star-ramp',
    covers:
      'flat-plug for a pocket in a star with a 3 mm bit, plug cut with the 6 mm bit (bigger than the pocket bit) and tool ramp',
    model: project({
      shapes: [STAR],
      tools: [
        em3,
        tool('t-em6r', 4, 'end-mill', 6, { ramp: true, rampAngle: 3 }),
      ],
      operations: [
        pocket('o-pocket', 't-em3', 's-star', { depth: 3 }),
        flatPlug('o-plug', 't-em6r', 's-star', 'o-pocket', { inlayGap: 0 }),
      ],
    }),
  },
  {
    name: 'flat-plug-raster-pocket-rounded',
    covers:
      'flat-plug for a raster pocket in a rounded rectangle, gap 0.15, mirrored',
    model: project({
      shapes: [rect('s-rect', 40, 25, 4)],
      tools: [em6],
      operations: [
        pocket('o-pocket', 't-em6', 's-rect', { strategy: 'raster', depth: 3 }),
        flatPlug('o-plug', 't-em6', 's-rect', 'o-pocket', {
          inlayGap: 0.15,
          plugMirror: true,
        }),
      ],
    }),
  },
] satisfies Fixture[];
