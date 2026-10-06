import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { toolFeedsAndSpeeds } from './feeds-and-speeds';
import type { HeaderAction } from '../components/array-type-component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

export type BitType =
  'end-mill' | 'ball-nose' | 'bull-nose' | 'v-bit' | 'drill';

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
};

const hideUnlessBit = (type: BitType) => (field: FormlyFieldConfig) =>
  field.model?.bitType !== type;
const hideUnlessVBit = hideUnlessBit('v-bit');

export type ToolType = {
  id: string;
  expanded: boolean;

  name?: string;
  bitType?: BitType;
  diameter: number;
  vAngle: number;
  tipDiameter: number;
  /** Bull nose: the radius of its rounded corners (mm). */
  cornerRadius?: number;
  /** Drill: the angle of its point (degrees, 118 for most twist drills). */
  pointAngle?: number;
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
    accent: '#ea580c',
    collapsible: true,
    headerActions: [
      {
        label: 'Library',
        title: 'Tool library: tools kept for every project',
        async run({ injector, items, add }) {
          const { ToolLibraryDialogComponent } =
            await import('../components/tool-library-dialog.component');
          const ref = injector.get(NgbModal).open(ToolLibraryDialogComponent, {
            centered: true,
            scrollable: true,
            ariaLabelledBy: 'library-title',
          });
          Object.assign(ref.componentInstance, {
            // As they are now: the live list fills in an added tool later.
            projectTools: structuredClone(items),
            addToProject: (tool: object) => add(tool),
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
            describeTool(field.model),
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
      toolFeedsAndSpeeds,
    ],
  },
};
