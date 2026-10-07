import { Fixture, project } from './fixture';
import {
  DISC_WITH_HOLES,
  pathData,
  polyline,
  star,
  text,
  tool,
  vBit,
  vCarve,
  vCarveClear,
} from './operations-parts';

// V-carving: modes, depths, stepover vs single pass, flat bottoms, centre
// lines, sharp corners, ramps, open paths, and clearings before (or after,
// or disabled) the v-carve, which let it go below the V's cone.

/** 6.35 mm 60° V-bit: cone 5.5 mm tall. */
const v60 = vBit('t-v60', 1, 6.35, 60);
/** 12 mm 90° V-bit: cone 6 mm tall. */
const v90 = vBit('t-v90', 2, 12, 90);
const em3 = tool('t-em3', 3, 'end-mill', 3);
const em6 = tool('t-em6', 4, 'end-mill', 6);

const E = text('s-e', 'e', 30);
const B = text('s-b', 'B', 30, 800);
const STAR = polyline('s-star', star(30, 30, 28, 12), true);

export default [
  {
    name: 'vcarve-text-stepover-flat-bottom',
    covers:
      'v-carve, text "e", 60° bit, maxDepth 2, stepover 0.3, clearFlatBottom on, mode both',
    model: project({
      shapes: [E],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-e', { maxDepth: 2, stepover: 0.3 }),
      ],
    }),
  },
  {
    name: 'vcarve-no-flat-bottom',
    covers:
      'v-carve, text "e", maxDepth 1.5, stepover 0.3, clearFlatBottom off',
    model: project({
      shapes: [E],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-e', {
          maxDepth: 1.5,
          stepover: 0.3,
          clearFlatBottom: false,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-single-pass',
    covers:
      'v-carve, stepover empty (null): a single pass along the centre line, text "B" weight 800',
    model: project({
      shapes: [B],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-b', { stepover: null, maxDepth: 3 }),
      ],
    }),
  },
  {
    name: 'vcarve-stepover-zero',
    covers: 'v-carve, stepover 0 (read as a single pass), star polyline',
    model: project({
      shapes: [STAR],
      tools: [v90],
      operations: [
        vCarve('o-vcarve', 't-v90', 's-star', { stepover: 0, maxDepth: 4 }),
      ],
    }),
  },
  {
    name: 'vcarve-unlimited-depth',
    covers:
      'v-carve, unlimitedDepth (full V everywhere, no flat bottom), stepover 0.5, star, 90° bit',
    model: project({
      shapes: [STAR],
      tools: [v90],
      operations: [
        vCarve('o-vcarve', 't-v90', 's-star', {
          unlimitedDepth: true,
          stepover: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-center-line',
    covers:
      'v-carve, stepover 0.4 with centerLine (extra pass on the centre line at full depth), text "B"',
    model: project({
      shapes: [B],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-b', {
          stepover: 0.4,
          centerLine: true,
          maxDepth: 2.5,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-sharp-corners-off',
    covers:
      'v-carve, sharpCorners off, star (sharp convex corners), single pass',
    model: project({
      shapes: [STAR],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-star', {
          sharpCorners: false,
          stepover: null,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-sharp-corner-angle-100',
    covers:
      'v-carve, sharpCorners on with sharpCornerAngle 100 (fewer corners sharpened), star, single pass',
    model: project({
      shapes: [STAR],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-star', {
          sharpCornerAngle: 100,
          stepover: null,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-sharp-corner-angle-175',
    covers:
      'v-carve, sharpCornerAngle 175 (nearly every corner sharpened), text "e", stepover 0.3',
    model: project({
      shapes: [E],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-e', {
          sharpCornerAngle: 175,
          stepover: 0.3,
          maxDepth: 2,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-mode-holes',
    covers:
      'v-carve, mode holes (round the holes only), disc with a round and a square hole',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [v90],
      operations: [
        vCarve('o-vcarve', 't-v90', 's-disc', {
          mode: 'holes',
          maxDepth: 2,
          stepover: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-mode-contours',
    covers:
      'v-carve, mode contours (outline only, holes ignored), text "B" weight 800',
    model: project({
      shapes: [B],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-b', {
          mode: 'contours',
          maxDepth: 2,
          stepover: 0.4,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-start-depth',
    covers:
      'v-carve, startDepth 0.5 (surface below zero), maxDepth 2, stepover 0.3, text "e"',
    model: project({
      shapes: [E],
      tools: [v60],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-e', {
          startDepth: 0.5,
          maxDepth: 2,
          stepover: 0.3,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-tip-diameter',
    covers:
      'v-carve with a flat-tipped V-bit (tipDiameter 0.5, 90°), star, stepover 0.5',
    model: project({
      shapes: [STAR],
      tools: [vBit('t-vtip', 1, 12, 90, { tipDiameter: 0.5 })],
      operations: [
        vCarve('o-vcarve', 't-vtip', 's-star', { maxDepth: 3, stepover: 0.5 }),
      ],
    }),
  },
  {
    name: 'vcarve-ramp',
    covers:
      'v-carve with tool ramp (5°) and a second with rampMode plunge, star, stepover 0.5',
    model: project({
      shapes: [STAR],
      tools: [vBit('t-v90r', 1, 12, 90, { ramp: true, rampAngle: 5 })],
      operations: [
        vCarve('o-ramp', 't-v90r', 's-star', { maxDepth: 2, stepover: 0.5 }),
        vCarve('o-plunge', 't-v90r', 's-star', {
          maxDepth: 2,
          stepover: 0.5,
          rampMode: 'plunge',
        }),
      ],
    }),
  },
  {
    name: 'vcarve-open-path-engrave',
    covers:
      'v-carve on open polylines (engraving at max depth 1), single pass and stepover',
    model: project({
      shapes: [
        polyline(
          's-zigzag',
          [
            [0, 0],
            [15, 20],
            [30, 0],
            [45, 20],
            [60, 0],
          ],
          false,
        ),
      ],
      tools: [v60],
      operations: [
        vCarve('o-single', 't-v60', 's-zigzag', {
          maxDepth: 1,
          stepover: null,
        }),
        vCarve('o-stepover', 't-v60', 's-zigzag', {
          maxDepth: 1,
          stepover: 0.3,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-cleared-first',
    covers:
      'v-carve-clear (3 mm end mill) listed before the v-carve: v-carve goes beyond its cone (maxDepth 8 > 5.5), clearFlatBottom on',
    model: project({
      shapes: [B],
      tools: [v60, em3],
      operations: [
        vCarveClear('o-clear', 't-em3', 's-b', 'o-vcarve', {
          depthPerStep: 2,
          leaveStock: 0.1,
        }),
        vCarve('o-vcarve', 't-v60', 's-b', { maxDepth: 8, stepover: 0.4 }),
      ],
    }),
  },
  {
    name: 'vcarve-cleared-first-single-pass',
    covers:
      'v-carve-clear before a single-pass v-carve (stepover null), star, maxDepth 4, clearing leaveStock 0',
    model: project({
      shapes: [STAR],
      tools: [v90, em6],
      operations: [
        vCarveClear('o-clear', 't-em6', 's-star', 'o-vcarve', {
          leaveStock: 0,
          depthPerStep: 1.5,
        }),
        vCarve('o-vcarve', 't-v90', 's-star', { maxDepth: 4, stepover: null }),
      ],
    }),
  },
  {
    name: 'vcarve-clearing-after',
    covers:
      'v-carve-clear listed after its v-carve (not cleared first: v-carve capped at cone, flat bottom fully cleared by the V)',
    model: project({
      shapes: [B],
      tools: [v60, em3],
      operations: [
        vCarve('o-vcarve', 't-v60', 's-b', { maxDepth: 3, stepover: 0.4 }),
        vCarveClear('o-clear', 't-em3', 's-b', 'o-vcarve'),
      ],
    }),
  },
  {
    name: 'vcarve-clearing-disabled',
    covers:
      'disabled v-carve-clear before the v-carve (still counts as cleared first: beyondCone and only the leftover flat bottom)',
    model: project({
      shapes: [B],
      tools: [v60, em3],
      operations: [
        {
          ...vCarveClear('o-clear', 't-em3', 's-b', 'o-vcarve'),
          disabled: true,
        },
        vCarve('o-vcarve', 't-v60', 's-b', { maxDepth: 6, stepover: 0.4 }),
      ],
    }),
  },
  {
    name: 'vcarve-two-clearings',
    covers:
      'two v-carve-clears (6 mm then 3 mm end mill, the second rest-like) before one v-carve, star, maxDepth 5',
    model: project({
      shapes: [STAR],
      tools: [v90, em6, em3],
      operations: [
        vCarveClear('o-clear6', 't-em6', 's-star', 'o-vcarve', {
          leaveStock: 0.2,
        }),
        vCarveClear('o-clear3', 't-em3', 's-star', 'o-vcarve', {
          leaveStock: 0.1,
        }),
        vCarve('o-vcarve', 't-v90', 's-star', { maxDepth: 5, stepover: 0.5 }),
      ],
    }),
  },
  {
    name: 'vcarve-clear-depth-engagement',
    covers:
      'v-carve-clear depthPerStep 0.75, toolEngagement 0.7, leaveStock 0.3, unlimited-depth v-carve after it',
    model: project({
      shapes: [STAR],
      tools: [v90, em3],
      operations: [
        vCarveClear('o-clear', 't-em3', 's-star', 'o-vcarve', {
          depthPerStep: 0.75,
          toolEngagement: 0.7,
          leaveStock: 0.3,
        }),
        vCarve('o-vcarve', 't-v90', 's-star', {
          unlimitedDepth: true,
          stepover: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-clear-ramp',
    covers:
      'v-carve-clear with tool ramp (4°), and one with rampMode ramp angle 8 on a plunging tool; mode holes v-carve',
    model: project({
      shapes: [pathData('s-disc', DISC_WITH_HOLES)],
      tools: [
        v90,
        tool('t-em3r', 3, 'end-mill', 3, { ramp: true, rampAngle: 4 }),
        em6,
      ],
      operations: [
        vCarveClear('o-clear-tool', 't-em3r', 's-disc', 'o-vcarve', {
          depthPerStep: 1,
        }),
        vCarveClear('o-clear-op', 't-em6', 's-disc', 'o-vcarve', {
          rampMode: 'ramp',
          rampAngle: 8,
        }),
        vCarve('o-vcarve', 't-v90', 's-disc', {
          mode: 'holes',
          maxDepth: 4,
          stepover: 0.5,
        }),
      ],
    }),
  },
  {
    name: 'vcarve-clear-ball-nose-start-depth',
    covers:
      'v-carve-clear with a ball-nose bit, borrowing the v-carve startDepth 1 and mode contours',
    model: project({
      shapes: [B],
      tools: [v60, tool('t-ball', 3, 'ball-nose', 3)],
      operations: [
        vCarveClear('o-clear', 't-ball', 's-b', 'o-vcarve', {
          depthPerStep: 1,
        }),
        vCarve('o-vcarve', 't-v60', 's-b', {
          mode: 'contours',
          startDepth: 1,
          maxDepth: 4,
          stepover: 0.4,
        }),
      ],
    }),
  },
] satisfies Fixture[];
