import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn } from '../variables/field';
import { allTools } from '../tools';

/** Drill holes at the shape's points (and, if asked, outline centres). */
export interface ModelType {
  type?: 'drill';
  drillAt: 'points' | 'centers';
  startDepth: number;
  depth: number;
  /** Depth per peck; 0 drills in one go. */
  peck: number;
  /** Between pecks, lift only to break the chip (else all the way out). */
  chipBreak: boolean;
  /** Seconds at the bottom. */
  dwell: number;
  /** Rapid down to this far above the material before drilling (mm). */
  retractHeight: number;
  /** A drill bit's point goes deeper so its full diameter reaches the depth. */
  fullDiameter: boolean;
  /** Canned cycles (G81–G83) or plain moves (GRBL has no cycles). */
  output: 'moves' | 'cycles';
}

const hideUnlessDrill = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'drillAt',
      type: 'enum',
      defaultValue: 'centers',
      props: {
        label: 'drill at',
        required: true,
        options: [
          { value: 'centers', label: 'points, and the centre of each outline' },
          { value: 'points', label: 'points only' },
        ],
      },
    },
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: { label: 'start depth', required: true },
    },
    {
      key: 'depth',
      type: 'number',
      defaultValue: 5,
      props: { label: 'depth', min: 0, required: true },
    },
    {
      key: 'fullDiameter',
      type: 'boolean',
      defaultValue: false,
      props: {},
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessDrill(field) || drillTool(field)?.bitType !== 'drill',
        'props.label': (field: FormlyFieldConfig) => {
          const tool = drillTool(field);
          const extra = pointLength(
            numberIn(field, tool?.diameter),
            numberIn(field, tool?.pointAngle),
          );
          return `full diameter at that depth (+${extra.toFixed(2)} mm for the point)`;
        },
      },
    },
    {
      key: 'peck',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'peck',
        description: 'mm per peck; 0 drills in one go',
        min: 0,
        required: true,
      },
    },
    {
      key: 'chipBreak',
      type: 'boolean',
      defaultValue: false,
      props: { label: 'between pecks, only lift to break the chip' },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessDrill(field) ||
          !((numberIn(field, field.model?.peck) ?? 0) > 0),
      },
    },
    {
      key: 'dwell',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'dwell',
        description: 'seconds at the bottom',
        min: 0,
        required: true,
      },
    },
    {
      key: 'retractHeight',
      type: 'number',
      defaultValue: 1,
      props: {
        label: 'retract to',
        description: 'mm above the material, between pecks',
        min: 0,
        required: true,
      },
    },
    {
      key: 'output',
      type: 'enum',
      defaultValue: 'moves',
      props: {
        label: 'write as',
        required: true,
        options: [
          { value: 'moves', label: 'moves (works everywhere, e.g. GRBL)' },
          { value: 'cycles', label: 'canned cycles (G81 / G82 / G83 / G73)' },
        ],
      },
    },
  ],
  expressions: { hide: hideUnlessDrill },
};

function drillTool(field: FormlyFieldConfig) {
  return allTools(field).find((t) => t.id === field.model?.toolId);
}

/** How much deeper a drill's point goes than its full diameter. */
export function pointLength(
  diameter: number | undefined,
  pointAngle: number | undefined,
) {
  if (!diameter || !pointAngle || pointAngle >= 180) return 0;
  return diameter / 2 / Math.tan(((pointAngle / 2) * Math.PI) / 180);
}

export const Definition = {
  type: 'drill',
  label: 'drill',
  fieldGroup: field,
} as const;
