import { ModelType, OperationParameters } from '../model-editor/model';
import type { InlayPlug } from '../../worker/work/inlay-plug';
import { depthPerStep } from '../model-editor/operations/depth-steps';
import { withOverrides } from '../model-editor/tools/feeds-and-speeds';
import type { ClearingTool } from '../../worker/work/route-vcarve-clearing';

/**
 * What a v-carve clearing borrows from the v-carve (or inlay plug) it
 * clears for.
 */
export type VCarveSource = {
  shapeId: string;
  vToolSize: number;
  vAngle: number;
  tipDiameter: number;
  startDepth: number;
  maxDepth: number | null;
  beyondCone: boolean;
  mode: 'both' | 'holes' | 'contours';
  /** Clearing for an inlay plug: carve round the design instead. */
  plug: InlayPlug | null;
};

/** What an inlay plug takes from the v-carve cutting its pocket. */
export type PlugSource = {
  shapeId: string;
  /** Depth the plug is carved to (mm). */
  maxDepth: number;
  plug: InlayPlug;
  stepover: number | null;
  centerLine: boolean;
  sharpCorners: boolean;
  sharpCornerAngle: number;
};

/** What rest machining takes from the pocket it finishes. */
export type RestSource = {
  shapeId: string;
  startDepth: number;
  depthPerStep: number;
  steps: number;
  leaveStock: number;
  previousToolSize: number;
};

/** What a flat inlay plug takes from the pocket it fills. */
export type FlatPlugSource = {
  shapeId: string;
  /** The pocket's bit, which rounds its corners. */
  pocketToolSize: number;
};

type Operations = ModelType['operations'];
type Tools = ModelType['tools'];

/**
 * For an inlay plug: its geometry, from the v-carve cutting the pocket (its
 * max depth, minus the glue gap, is how deep the plug's walls start) and
 * the plug's own V-bit. Null while either is missing.
 */
export function plugSource(
  operation: OperationParameters & { toolId?: string },
  operations: Operations,
  tools: Tools,
): PlugSource | null {
  if (operation.type !== 'inlay-plug') {
    return null;
  }
  const pocket = operations.find((o) => o.id === operation.vcarveOperationId);
  const tool = tools.find((t) => t.id === operation.toolId);
  if (
    pocket?.type !== 'v-carve' ||
    pocket.unlimitedDepth ||
    tool?.bitType !== 'v-bit'
  ) {
    return null;
  }
  const start = Math.max(0, pocket.maxDepth - Math.max(0, operation.inlayGap));
  const tan = Math.tan(((tool.vAngle / 2) * Math.PI) / 180);
  return {
    shapeId: pocket.shapeId,
    maxDepth: start + Math.max(0, operation.inlayAbove),
    plug: { grow: start * tan, margin: operation.inlayMargin },
    stepover: pocket.stepover && pocket.stepover > 0 ? pocket.stepover : null,
    centerLine: !!pocket.centerLine,
    sharpCorners: pocket.sharpCorners ?? true,
    sharpCornerAngle: pocket.sharpCornerAngle ?? 150,
  };
}

/** For rest machining: the pocket it finishes, and that pocket's tool. */
export function restSource(
  operation: OperationParameters,
  operations: Operations,
  tools: Tools,
): RestSource | null {
  if (operation.type !== 'rest') {
    return null;
  }
  const pocket = operations.find((o) => o.id === operation.pocketOperationId);
  const tool = tools.find((t) => t.id === pocket?.toolId);
  if (pocket?.type !== 'pocket' || !tool) {
    return null;
  }
  return {
    shapeId: pocket.shapeId,
    startDepth: pocket.startDepth,
    depthPerStep: depthPerStep(pocket),
    steps: pocket.steps,
    leaveStock: pocket.leaveStock,
    previousToolSize: tool.diameter,
  };
}

/**
 * For a v-carve clearing operation: the v-carve it clears for (shape,
 * V-bit and depths). Null for other operations, or while that v-carve or
 * its V-bit is missing.
 */
export function vCarveSource(
  operation: OperationParameters,
  operations: ModelType['operations'],
  tools: ModelType['tools'],
): VCarveSource | null {
  if (operation.type !== 'v-carve-clear') {
    return null;
  }
  const vcarve = operations.find((o) => o.id === operation.vcarveOperationId);
  const tool = tools.find((t) => t.id === vcarve?.toolId);
  if (tool?.bitType !== 'v-bit') {
    return null;
  }
  if (vcarve?.type === 'inlay-plug') {
    const plug = plugSource(vcarve, operations, tools);
    return plug
      ? {
          shapeId: plug.shapeId,
          vToolSize: tool.diameter,
          vAngle: tool.vAngle,
          tipDiameter: tool.tipDiameter,
          startDepth: 0,
          maxDepth: plug.maxDepth,
          beyondCone: clearedFirst(vcarve.id, operations, tools),
          mode: 'both',
          plug: plug.plug,
        }
      : null;
  }
  if (vcarve?.type !== 'v-carve') {
    return null;
  }
  return {
    shapeId: vcarve.shapeId,
    vToolSize: tool.diameter,
    vAngle: tool.vAngle,
    tipDiameter: tool.tipDiameter,
    startDepth: vcarve.startDepth,
    maxDepth: vcarve.unlimitedDepth ? null : vcarve.maxDepth,
    beyondCone: clearedFirst(vcarve.id, operations, tools),
    mode: vcarve.mode ?? 'both',
    plug: null,
  };
}

/**
 * An end mill clearing for a v-carve (or inlay plug) before it: what routes
 * the clearing, besides what it borrows from the v-carve.
 */
export type Clearing = ClearingTool;

/**
 * The clearings for v-carve `vcarveId` that come before it and use an end
 * mill. With any, the groove's middle is gone before the V-bit arrives, so
 * it can carve below its cone without the shank meeting uncut material, and
 * its flat bottom only needs what they left. Disabled ones count too: the
 * v-carve is planned for them having been cut (in a file of their own, say).
 */
export function clearingsBefore(
  vcarveId: string,
  operations: ModelType['operations'],
  tools: ModelType['tools'],
): Clearing[] {
  const vcarveIndex = operations.findIndex((o) => o.id === vcarveId);
  return operations.flatMap((o, index) => {
    if (
      index >= vcarveIndex ||
      o.type !== 'v-carve-clear' ||
      o.vcarveOperationId !== vcarveId
    ) {
      return [];
    }
    const found = tools.find((t) => t.id === o.toolId);
    if (!found || ['v-bit', 'drill'].includes(found.bitType ?? 'end-mill')) {
      return [];
    }
    const tool = withOverrides(found, o);
    return [
      {
        toolSize: tool.diameter,
        toolEngagement: o.toolEngagement,
        depthPerStep: o.depthPerStep,
        leaveStock: o.leaveStock,
        rampAngle: (tool.ramp && tool.rampAngle) || null,
      },
    ];
  });
}

/** Whether v-carve `vcarveId` is cleared first (see clearingsBefore). */
export function clearedFirst(
  vcarveId: string,
  operations: ModelType['operations'],
  tools: ModelType['tools'],
): boolean {
  return clearingsBefore(vcarveId, operations, tools).length > 0;
}

/** For a flat inlay plug: the pocket it fills, and that pocket's bit size. */
export function flatPlugSource(
  operation: OperationParameters,
  operations: Operations,
  tools: Tools,
): FlatPlugSource | null {
  if (operation.type !== 'flat-plug') {
    return null;
  }
  const pocket = operations.find((o) => o.id === operation.pocketOperationId);
  const tool = tools.find((t) => t.id === pocket?.toolId);
  if (pocket?.type !== 'pocket' || !tool) {
    return null;
  }
  return { shapeId: pocket.shapeId, pocketToolSize: tool.diameter };
}
