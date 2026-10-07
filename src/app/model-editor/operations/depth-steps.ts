import { FormlyFieldConfig } from '@ngx-formly/core';
import { NumberInput } from '../variables/evaluate';
import { numberIn } from '../variables/field';

/**
 * How an operation's `depth` is read: the depth of each step (the total is
 * depth × steps), or the total depth (each step is depth ÷ steps).
 */
export type DepthMode = 'per-step' | 'total';

/** The depth settings of operations that cut in steps down. */
export interface DepthSteps {
  startDepth: number;
  /** Missing in projects from before it existed: per step. */
  depthMode?: DepthMode;
  depth: number;
  steps: number;
}

type Resolved = {
  depthMode?: DepthMode;
  depth?: number | null;
  steps?: number | null;
};

/** How deep each step goes (from a resolved model). */
export function depthPerStep({ depthMode, depth, steps }: Resolved): number {
  if (depthMode !== 'total') {
    return depth ?? 0;
  }
  return steps && steps > 0 ? (depth ?? 0) / steps : 0;
}

/** How deep all the steps go together, below the start depth. */
export function totalDepth({ depthMode, depth, steps }: Resolved): number {
  return depthMode === 'total' ? (depth ?? 0) : (depth ?? 0) * (steps ?? 0);
}

/**
 * `depth` read the other way round (`to` is the new mode), so switching
 * keeps the cut as it was. Plain numbers stay numbers where the result is
 * a round one; otherwise it's written as an expression (`5 / 3`, `d * 2`).
 * Undefined when there's nothing to convert.
 */
export function convertDepth(
  depth: NumberInput,
  steps: NumberInput,
  to: DepthMode,
): NumberInput {
  if (depth === null || depth === undefined || depth === '') {
    return undefined;
  }
  if (steps === null || steps === undefined || steps === '') {
    return undefined;
  }
  const operator = to === 'total' ? '*' : '/';
  if (typeof depth === 'number' && typeof steps === 'number') {
    if (!(steps > 0)) {
      return undefined;
    }
    const value = to === 'total' ? depth * steps : depth / steps;
    const rounded = +value.toFixed(6);
    if (Math.abs(rounded - value) < 1e-9) {
      return rounded;
    }
  }
  const term = (input: number | string) =>
    /^[\w.]+$/.test(String(input).trim())
      ? String(input).trim()
      : `(${String(input).trim()})`;
  return `${term(depth)} ${operator} ${term(steps)}`;
}

const mm = (value: number) => `${Math.round(value * 1000) / 1000} mm`;

/**
 * The fields for start depth, depth (per step or in all) and steps; the
 * same for every operation that cuts in steps down. Fresh objects on each
 * call (Formly keeps its state in them).
 */
export function depthStepsFields({
  depth = 5,
  startDepth = 0,
}: { depth?: number; startDepth?: number } = {}): FormlyFieldConfig[] {
  return [
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: startDepth,
      props: {
        label: 'start depth',
        required: true,
      },
    },
    {
      key: 'depthMode',
      type: 'enum',
      defaultValue: 'per-step',
      props: {
        label: 'depth given as',
        required: true,
        options: [
          { value: 'per-step', label: 'depth per step × steps' },
          { value: 'total', label: 'total depth ÷ steps' },
        ],
        // Keep the cut as it was: convert the depth to the new reading.
        change: (field: FormlyFieldConfig) => {
          const model = field.model;
          const to: DepthMode =
            field.formControl?.value === 'total' ? 'total' : 'per-step';
          const converted = convertDepth(model?.depth, model?.steps, to);
          const depthField = field.parent?.fieldGroup?.find(
            (f) => f.key === 'depth',
          );
          if (converted !== undefined && depthField?.formControl) {
            depthField.formControl.setValue(converted);
          }
        },
      },
    },
    {
      key: 'depth',
      type: 'number',
      defaultValue: depth,
      props: {
        min: 0,
        required: true,
      },
      expressions: {
        'props.label': (field: FormlyFieldConfig) =>
          field.model?.depthMode === 'total' ? 'total depth' : 'depth/step',
        // The other reading, worked out.
        'props.description': (field: FormlyFieldConfig) => {
          const resolved = {
            depthMode: field.model?.depthMode,
            depth: numberIn(field, field.model?.depth),
            steps: numberIn(field, field.model?.steps),
          };
          if (resolved.depth === undefined || !(resolved.steps! > 0)) {
            return '';
          }
          return resolved.depthMode === 'total'
            ? `${mm(depthPerStep(resolved))} per step`
            : `${mm(totalDepth(resolved))} in all`;
        },
      },
    },
    {
      key: 'steps',
      type: 'number',
      defaultValue: 1,
      props: {
        min: 1,
        label: 'steps',
        required: true,
      },
      validators: { validation: ['whole-number'] },
    },
  ];
}
