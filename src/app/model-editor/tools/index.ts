import { FormlyFieldConfig } from '@ngx-formly/core';
import { AbstractControl } from '@angular/forms';
import { numberIn, resolvedItem, resolvedModelOf } from '../variables/field';
import { rootModel } from '../shapes/describe';
import { toolFeedsAndSpeeds } from './feeds-and-speeds';
import type { HeaderAction } from '../components/array-type-component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

export type BitType =
  'end-mill' | 'ball-nose' | 'bull-nose' | 'v-bit' | 'drill' | 'keyhole';

/** Bits that cut sideways (everything but a drill). */
export const SIDE_CUTTING: readonly BitType[] = [
  'end-mill',
  'ball-nose',
  'bull-nose',
  'v-bit',
];
/** Bits with a round body that clear area (no V, no drill point). */
export const ROUND_CUTTERS: readonly BitType[] = [
  'end-mill',
  'ball-nose',
  'bull-nose',
];

export const BIT_TYPE_LABELS: Record<BitType, string> = {
  'end-mill': 'end mill',
  'ball-nose': 'ball nose',
  'bull-nose': 'bull nose',
  'v-bit': 'v-bit',
  drill: 'drill',
  keyhole: 'keyhole',
};

const hideUnlessBit = (type: BitType) => (field: FormlyFieldConfig) =>
  field.model?.bitType !== type;
const hideUnlessVBit = hideUnlessBit('v-bit');

export type ToolType = {
  id: string;
  expanded: boolean;

  name?: string;
  /**
   * Its number in the G-code (`T<index>`), whatever its place in the list.
   * Unique among the project's tools.
   */
  index?: number;
  bitType?: BitType;
  diameter: number;
  vAngle: number;
  tipDiameter: number;
  /** Bull nose: the radius of its rounded corners (mm). */
  cornerRadius?: number;
  /** Drill: the angle of its point (degrees, 118 for most twist drills). */
  pointAngle?: number;
  /** Keyhole: the diameter of the neck above its head (mm). */
  neckDiameter?: number;
  /** Keyhole: how tall its head is (mm). */
  headHeight?: number;
  /** Optional; overrides the G-code section's carve feed rate. */
  feedRate?: number | null;
  /** Optional; overrides the G-code section's plunge feed rate. */
  plungeFeedRate?: number | null;
  /** Optional; overrides the G-code section's spindle speed. */
  spindleSpeed?: number | null;
  /**
   * Ramp down into cuts along the toolpath instead of plunging (pocket,
   * profile, v-carve and v-carve clearing).
   */
  ramp?: boolean;
  /** Degrees below horizontal. */
  rampAngle?: number;
};

export type ModelType = {
  tools: Array<ToolType>;
};

/** All tools in the model, from any field in the form. */
export function allTools(field: FormlyFieldConfig | undefined): ToolType[] {
  return rootModel(field)?.tools ?? [];
}

/** The tool's own name, or one built from its settings. */
export function toolLabel(tool: Partial<ToolType> | undefined): string {
  return tool?.name || describeTool(tool);
}

/**
 * The tool's number in the G-code: its index, or for a tool without one,
 * its position in the list (from 1).
 */
export function toolNumber(tool: ToolType, tools: readonly ToolType[]): number {
  return typeof tool.index === 'number' ? tool.index : tools.indexOf(tool) + 1;
}

/** The lowest index no tool in `tools` has, from 1. */
export function freeToolIndex(
  tools: readonly Partial<ToolType>[],
  index: (tool: Partial<ToolType>) => number | undefined = (tool) =>
    typeof tool?.index === 'number' ? tool.index : undefined,
): number {
  const taken = new Set(tools.map(index));
  let free = 1;
  while (taken.has(free)) free++;
  return free;
}

/**
 * The tool's name for the editor: its index then its label, e.g.
 * "T2 Ø6 mm end mill". `index` is the worked-out index, when the tool's
 * own may be an expression.
 */
export function numberedToolLabel(
  tool: Partial<ToolType> | undefined,
  index: unknown = tool?.index,
): string {
  const label = toolLabel(tool);
  return typeof index === 'number' && Number.isFinite(index)
    ? `T${index} ${label}`
    : label;
}

/** The other tool with the same index as the one `field` belongs to. */
function sameIndexTool(field: FormlyFieldConfig): ToolType | undefined {
  const index = numberIn(field, field.formControl?.value);
  if (index === undefined) {
    return undefined;
  }
  return allTools(field).find(
    (tool) =>
      tool !== field.model &&
      tool?.id !== field.model?.id &&
      numberIn(field, tool?.index) === index,
  );
}

/** A readable name built from the tool's settings, e.g. "Ø6 mm 60° v-bit". */
export function describeTool(tool: Partial<ToolType> | undefined): string {
  const parts: string[] = [];
  if (tool?.diameter) {
    parts.push(`Ø${tool.diameter} mm`);
  }
  switch (tool?.bitType) {
    case 'v-bit':
      if (tool.vAngle) {
        parts.push(`${tool.vAngle}°`);
      }
      parts.push('v-bit');
      if (tool.tipDiameter) {
        parts.push(`(${tool.tipDiameter} mm tip)`);
      }
      break;
    case 'bull-nose':
      parts.push('bull nose');
      if (tool.cornerRadius) {
        parts.push(`r${tool.cornerRadius}`);
      }
      break;
    case 'ball-nose':
    case 'drill':
      parts.push(BIT_TYPE_LABELS[tool.bitType]);
      break;
    case 'keyhole':
      parts.push('keyhole');
      if (tool.neckDiameter) {
        parts.push(`(neck Ø${tool.neckDiameter})`);
      }
      break;
    default:
      parts.push('end mill');
  }
  return parts.join(' ');
}

export const field: FormlyFieldConfig = {
  key: 'tools',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'tools',
    itemLabel: 'tool',
    describeItem: describeTool,
    // Tools are known by their index: T2 in the G-code.
    itemPrefix: (tool: Partial<ToolType>) =>
      typeof tool?.index === 'number' ? `T${tool.index}` : '',
    accent: '#ea580c',
    collapsible: true,
    headerActions: [
      {
        label: 'Library',
        title: 'Tool library: tools kept for every project',
        async run({ injector, field, items, add }) {
          const { ToolLibraryDialogComponent } =
            await import('../components/tool-library-dialog.component');
          const ref = injector.get(NgbModal).open(ToolLibraryDialogComponent, {
            centered: true,
            scrollable: true,
            ariaLabelledBy: 'library-title',
          });
          Object.assign(ref.componentInstance, {
            // As they are now: the live list fills in an added tool later.
            // Expressions are worked out: the library has no variables.
            projectTools: structuredClone(
              items.map((tool) => resolvedItem(field, tool)),
            ),
            // A library tool keeps its index unless a tool here has it;
            // then it gets a free one.
            addToProject: ({ index, ...tool }: Partial<ToolType>) => {
              const free =
                index !== undefined &&
                !items.some((t) => numberIn(field, t?.index) === index);
              return add(free ? { ...tool, index } : tool);
            },
          });
          ref.result.catch(() => {});
        },
      } satisfies HeaderAction,
    ],
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'expanded',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeTool(resolvedModelOf(field)),
        },
      },
      {
        key: 'index',
        type: 'number',
        props: {
          label: 'tool index',
          description: 'its number in the G-code: T1, T2, …',
          min: 1,
          required: true,
        },
        validators: {
          validation: ['whole-number'],
          uniqueIndex: {
            expression: (_: AbstractControl, field: FormlyFieldConfig) =>
              !sameIndexTool(field),
            message: (_: unknown, field: FormlyFieldConfig) =>
              `“${toolLabel(sameIndexTool(field))}” has this index too`,
          },
        },
        hooks: {
          // A new tool gets the lowest index no other tool has.
          onInit: (field: FormlyFieldConfig) => {
            const value = field.formControl?.value;
            if (value === undefined || value === null || value === '') {
              field.formControl?.setValue(
                freeToolIndex(
                  allTools(field).filter((tool) => tool !== field.model),
                  (tool) => numberIn(field, tool?.index),
                ),
              );
            }
          },
        },
      },
      {
        key: 'bitType',
        type: 'enum',
        defaultValue: 'end-mill',
        props: {
          label: 'bit type',
          required: true,
          options: [
            { value: 'end-mill', label: 'end mill (flat)' },
            { value: 'ball-nose', label: 'ball nose' },
            { value: 'bull-nose', label: 'bull nose (rounded corners)' },
            { value: 'v-bit', label: 'v-bit / chamfer / engraving' },
            { value: 'drill', label: 'drill' },
            { value: 'keyhole', label: 'keyhole (T-slot) cutter' },
          ],
        },
      },
      {
        key: 'diameter',
        type: 'number',
        defaultValue: 3,
        props: {
          label: 'diameter',
          required: true,
        },
      },
      {
        key: 'vAngle',
        type: 'number',
        defaultValue: 60,
        props: {
          min: 1,
          max: 179,
          label: 'v angle',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      {
        key: 'tipDiameter',
        type: 'number',
        defaultValue: 0,
        props: {
          min: 0,
          label: 'tip diameter',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      {
        key: 'cornerRadius',
        type: 'number',
        defaultValue: 0.5,
        props: {
          min: 0,
          label: 'corner radius',
          required: true,
        },
        expressions: { hide: hideUnlessBit('bull-nose') },
      },
      {
        key: 'pointAngle',
        type: 'number',
        defaultValue: 118,
        props: {
          min: 1,
          max: 180,
          label: 'point angle',
          description: '°; 118 for most twist drills, 180 for a flat bottom',
          required: true,
        },
        expressions: { hide: hideUnlessBit('drill') },
      },
      {
        key: 'neckDiameter',
        type: 'number',
        defaultValue: 4.8,
        props: {
          min: 0,
          label: 'neck diameter',
          description: 'mm, the narrow part above the head: the slot’s width',
          required: true,
        },
        expressions: { hide: hideUnlessBit('keyhole') },
      },
      {
        key: 'headHeight',
        type: 'number',
        defaultValue: 3.2,
        props: {
          min: 0,
          label: 'head height',
          description: 'mm, how tall the cutting head is',
          required: true,
        },
        expressions: { hide: hideUnlessBit('keyhole') },
      },
      toolFeedsAndSpeeds,
    ],
  },
};
