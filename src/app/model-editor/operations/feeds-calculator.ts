import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  ballNoseWidth,
  Cut,
  FeedsAndSpeeds,
  feedsAndSpeeds,
  machineById,
  vBitWidth,
  woodById,
  woodMaterial,
} from '../../../cam/feeds-speeds';
import { resolvedItem } from '../variables/field';
import { rootModel } from '../shapes/describe';
import type { ToolType } from '../tools';
import { depthPerStep, totalDepth } from './depth-steps';

/** Flutes a tool has when it doesn't say. */
export const DEFAULT_FLUTES = 2;

/**
 * The cut an operation makes with its tool, for working out feeds and
 * speeds: its heaviest, usually the first pass of a step (a slot). Both
 * resolved; `operations` for what it borrows (rest machining its pocket's
 * steps, an inlay plug its v-carve's depth). Null when there's no telling.
 */
export function operationCut(
  op: any,
  tool: Partial<ToolType> | undefined,
  operations: readonly any[],
): Cut | null {
  const diameter = tool?.diameter ?? 0;
  if (!op || !(diameter > 0)) {
    return null;
  }
  const flutes = tool?.flutes ?? DEFAULT_FLUTES;
  const bit = tool?.bitType ?? 'end-mill';
  const borrowed = (id: string | undefined) =>
    operations.find((o) => o?.id === id);

  if (op.type === 'drill' || bit === 'drill') {
    const peck = op.peck ?? 0;
    return {
      kind: 'drill',
      diameter,
      depth: peck > 0 ? peck : (op.depth ?? 0),
    };
  }
  if (bit === 'keyhole' || op.type === 'keyhole') {
    // The head cuts a slot as tall as it is.
    const depth = tool?.headHeight ?? diameter / 2;
    return { kind: 'mill', diameter, flutes, depth, width: diameter };
  }

  // How deep each pass goes, how much of the bit's width it takes and how
  // deep the bit goes in all (a V-bit or ball nose cuts its widest there).
  let depth: number;
  let reach = 0;
  let engagement = 1;
  switch (op.type) {
    case 'pocket':
    case 'flat':
      depth = depthPerStep(op);
      reach = totalDepth(op);
      engagement = op.toolEngagement ?? 1;
      break;
    case 'rest': {
      const pocket = borrowed(op.pocketOperationId) ?? {};
      depth = depthPerStep(pocket);
      reach = totalDepth(pocket);
      engagement = op.toolEngagement ?? 1;
      break;
    }
    case 'v-carve-clear':
      depth = op.depthPerStep ?? 0;
      engagement = op.toolEngagement ?? 1;
      break;
    case 'helix':
      depth = op.pitch ?? 0;
      reach = op.depth ?? 0;
      break;
    case 'v-carve':
      depth = vCarveDepth(op, tool);
      break;
    case 'inlay-plug':
      depth = vCarveDepth(borrowed(op.vcarveOperationId), tool);
      break;
    case 'chamfer': {
      // One flank of the V cuts the bevel.
      const half = ((tool?.vAngle ?? 90) * Math.PI) / 360;
      const width = op.chamferWidth ?? 0;
      const total = width / Math.tan(half) + (op.extraDepth ?? 0);
      depth = total / Math.max(1, op.passes ?? 1);
      const cutting = widthAt(tool, total);
      return {
        kind: 'mill',
        diameter: cutting,
        flutes,
        depth,
        width: Math.min(cutting, width + (tool?.tipDiameter ?? 0) / 2),
        ...edgeOf(tool, cutting),
      };
    }
    default:
      // Profiles and flat plugs cut a slot each step.
      depth = depthPerStep(op);
      reach = totalDepth(op);
  }
  if (op.type === 'flat' && !(depth > 0)) {
    // Surfacing a skim: a light pass.
    depth = 0.5;
  }
  const cutting = widthAt(tool, Math.max(depth, reach));
  return {
    kind: 'mill',
    diameter: cutting,
    flutes,
    depth,
    width: Math.min(1, Math.max(0, engagement)) * cutting,
    // A pocket's first pass and corners take the whole width.
    loadWidth: cutting,
    ...edgeOf(tool, cutting),
  };
}

/**
 * For a bit whose edge slopes in the cut, cutting `cutting` mm wide: its
 * diameter (the chip load goes with it) and how much the slope thins the
 * chip (`Cut.edge`). Nothing for an end mill's straight side.
 */
function edgeOf(
  tool: Partial<ToolType> | undefined,
  cutting: number,
): { toolDiameter: number; edge: number } | {} {
  const diameter = tool?.diameter ?? 0;
  switch (tool?.bitType) {
    case 'v-bit':
      // The flank, V/2 off the axis, all the way up.
      return {
        toolDiameter: diameter,
        edge: Math.cos(((tool.vAngle ?? 90) * Math.PI) / 360),
      };
    case 'ball-nose':
      // Thickest at the top of the cut, where the ball is widest.
      return { toolDiameter: diameter, edge: cutting / diameter };
    default:
      return {};
  }
}

/** How wide the bit cuts `depth` deep. */
function widthAt(tool: Partial<ToolType> | undefined, depth: number): number {
  const diameter = tool?.diameter ?? 0;
  switch (tool?.bitType) {
    case 'v-bit':
      return vBitWidth(
        diameter,
        tool.vAngle ?? 90,
        tool.tipDiameter ?? 0,
        depth,
      );
    case 'ball-nose':
      return ballNoseWidth(diameter, depth);
    default:
      return diameter;
  }
}

/** How deep a v-carve goes: its max depth, never past the V. */
function vCarveDepth(op: any, tool: Partial<ToolType> | undefined): number {
  const half = ((tool?.vAngle ?? 90) * Math.PI) / 360;
  const cone =
    ((tool?.diameter ?? 0) - (tool?.tipDiameter ?? 0)) / 2 / Math.tan(half);
  if (!op || op.unlimitedDepth || !(op.maxDepth > 0)) {
    return cone;
  }
  return Math.min(op.maxDepth, cone);
}

/** The list (`repeat`) field `field` is in, and the item's field in it. */
function listItem(field: FormlyFieldConfig) {
  let item: FormlyFieldConfig | undefined = field;
  while (item?.parent && item.parent.type !== 'repeat') {
    item = item.parent;
  }
  return item?.parent ? { list: item.parent, item } : undefined;
}

/** A top-level list of the form (`tools`, `operations`). */
function topList(field: FormlyFieldConfig, key: string) {
  let root = field;
  while (root.parent) root = root.parent;
  return root.fieldGroup?.find((f) => f.key === key);
}

/** The wood the stock is, from any field in the form. */
function stockWood(field: FormlyFieldConfig) {
  return woodById(rootModel(field)?.stock?.material);
}

/** The machine the G-code section names, from any field in the form. */
function gcodeMachine(field: FormlyFieldConfig) {
  return machineById(rootModel(field)?.gcode?.machine);
}

/** The feeds and speeds the operation `field` belongs to would cut at. */
function suggestion(field: FormlyFieldConfig): FeedsAndSpeeds | null {
  const found = listItem(field);
  const toolsList = topList(field, 'tools');
  if (!found || !toolsList) {
    return null;
  }
  const { list, item } = found;
  const op = resolvedItem(list, item.model);
  const tool = (toolsList.model ?? []).find((t: any) => t?.id === op?.toolId);
  if (!tool) {
    return null;
  }
  const operations = (list.model ?? []).map((o: any) => resolvedItem(list, o));
  const cut = operationCut(op, resolvedItem(toolsList, tool), operations);
  return (
    cut &&
    feedsAndSpeeds(cut, gcodeMachine(field), woodMaterial(stockWood(field)))
  );
}

/** How the worked-out values come about, in a line. */
function describe(result: FeedsAndSpeeds | null): string {
  if (!result) {
    return 'needs a tool with a diameter';
  }
  const chip = Math.round(result.chipLoad * 1000) / 1000;
  const per = result.feedRate === undefined ? 'per turn' : 'per tooth';
  return [`${chip} mm chip ${per}`, ...result.notes].join('; ');
}

/** The overrides the calculation fills in. */
export type CalculatedKey = 'feedRate' | 'plungeFeedRate' | 'spindleSpeed';

/**
 * A checkbox (`autoFeeds`): while it's on, the operation's feed rate, plunge
 * rate and spindle speed are worked out for its tool, how it cuts, the
 * stock's wood and the G-code section's machine, and kept up to date as any
 * of them changes (see `calculatedFeedExpressions`).
 */
export const autoFeedsField: FormlyFieldConfig = {
  key: 'autoFeeds',
  type: 'boolean',
  defaultValue: true,
  expressions: {
    'props.label': (field: FormlyFieldConfig) =>
      `calculate for ${stockWood(field).name}`,
    'props.description': (field: FormlyFieldConfig) =>
      field.model?.autoFeeds
        ? `${gcodeMachine(field).name}: ${describe(suggestion(field))}`
        : 'from the tool (diameter, flutes), the cut (depth per step, engagement), the wood (stock section) and the machine (G-code section)',
  },
};

/**
 * For the input of `key`: while `autoFeeds` is on, read-only and holding
 * the worked-out value (empty where there's none, a drill's feed rate).
 */
export function calculatedFeedExpressions(
  key: CalculatedKey,
): NonNullable<FormlyFieldConfig['expressions']> {
  return {
    'props.readonly': (field: FormlyFieldConfig) => !!field.model?.autoFeeds,
    [`model.${key}`]: (field: FormlyFieldConfig) => {
      const own = field.model?.[key];
      if (!field.model?.autoFeeds) {
        return own;
      }
      const result = suggestion(field);
      return result ? (result[key] ?? null) : own;
    },
  };
}
