import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { allTools } from '../tools';
import { numberIn } from '../variables/field';

/** The operation type that rounds the blank on the rotary axis. */
export const ROTARY_ROUND = 'rotary-round';

/**
 * Rounds the blank on the rotary axis with an end mill over the axis: a
 * square blank into a cylinder, or a cylinder down to a smaller diameter,
 * a level at a time. No shape: it's the stock itself that's cut, between
 * two places along the axis (its ends unless given). Always wrapped (see
 * `operationWrap`).
 */
export interface ModelType {
  type?: 'rotary-round';
  /** The diameter the blank is left at (mm). */
  roundDiameter: number;
  /** Along the axis, where it starts and ends (the stock's ends if blank). */
  roundFrom?: number;
  roundTo?: number;
  /**
   * Lines along the axis, the stock turned a step between them, or rings
   * round it, a step along between them.
   */
  roundStrategy: 'along' | 'around';
  /** Share of the end mill's diameter between passes. */
  toolEngagement: number;
  /** How much nearer the axis each level is (mm). */
  depthPerStep: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'roundDiameter',
      type: 'number',
      props: {
        label: 'diameter',
        min: 0.1,
        required: true,
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) => {
          const stock = rootModel(field)?.stock;
          const n = (value: unknown) => numberIn(field, value as any) ?? 0;
          const round = (value: number) => Math.round(value * 100) / 100;
          if (stock?.shape === 'cylinder') {
            return `mm it’s turned down to (the stock is Ø${round(n(stock?.diameter))})`;
          }
          const across = n(
            stock?.rotaryAlong === 'y' ? stock?.width : stock?.height,
          );
          const thick = n(stock?.thickness);
          return `mm it’s left at: Ø${round(Math.min(across, thick))} or less for a whole cylinder (over its corners the stock is Ø${round(Math.hypot(across, thick))})`;
        },
      },
    },
    {
      key: 'roundFrom',
      type: 'number',
      props: {
        label: 'from',
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          `${axisOf(field)} where it starts; the stock’s end when left blank`,
      },
    },
    {
      key: 'roundTo',
      type: 'number',
      props: {
        label: 'to',
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          `${axisOf(field)} where it ends (leave what the chuck holds); the stock’s end when left blank. Short of an end, the bit stops with its edge there`,
      },
    },
    {
      key: 'roundStrategy',
      type: 'enum',
      defaultValue: 'along',
      props: {
        label: 'strategy',
        required: true,
        options: [
          { value: 'along', label: 'lines along the axis' },
          { value: 'around', label: 'rings round the stock' },
        ],
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) => {
          if (field.model?.roundStrategy === 'around') {
            return 'the stock turns a whole turn for each ring, one way then back: a true cylinder, but every ring goes all the way round, through the air between a square blank’s corners too';
          }
          const tool = allTools(field).find(
            (t) => t.id === field.model?.toolId,
          );
          const step =
            (numberIn(field, tool?.diameter) ?? 0) *
            (numberIn(field, field.model?.toolEngagement) ?? 0);
          const radius = (numberIn(field, field.model?.roundDiameter) ?? 0) / 2;
          const flats =
            step > 0 && radius > 0
              ? `, in flats ${Math.round(((step * step) / (8 * radius)) * 1000) / 1000} mm off round`
              : ', in narrow flats';
          return `the stock turns a step between lines, only where there’s material: quick on a square blank${flats}`;
        },
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.4,
      props: {
        min: 0.01,
        max: 1,
        label: 'engagement',
        required: true,
      },
    },
    {
      key: 'depthPerStep',
      type: 'number',
      defaultValue: 2,
      props: {
        min: 0.01,
        label: 'depth per step',
        description: 'mm nearer the axis each level',
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

/** The machine axis the rotary axis lies along, as a field says it. */
function axisOf(field: FormlyFieldConfig): string {
  return rootModel(field)?.stock?.rotaryAlong === 'y' ? 'Y' : 'X';
}

export const Definition = {
  type: ROTARY_ROUND,
  label: 'round the stock (4th axis)',
  fieldGroup: field,
} as const;
