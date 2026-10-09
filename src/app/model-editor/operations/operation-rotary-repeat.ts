import { FormlyFieldConfig } from '@ngx-formly/core';
import { numberIn } from '../variables/field';

/**
 * Turns the stock on the rotary axis to each of several angles and cuts its
 * own list of operations at each (a profile on every face, say). How the
 * angles are spaced: evenly round a full turn, a set angle apart, or spread
 * from the start angle to an end angle.
 */
export interface ModelType {
  type?: 'rotary-repeat';
  /** How many angles (positions). */
  steps: number;
  spacing: 'turn' | 'step' | 'range';
  /** Degrees of the first angle. */
  startAngle: number;
  /** `step`: degrees between angles. */
  stepAngle: number;
  /** `range`: degrees of the last angle. */
  endAngle: number;
  /**
   * `face`: every operation at one angle, then the next angle; `operation`:
   * each operation at every angle, then the next (fewer tool changes).
   */
  order: 'face' | 'operation';
  /** What's cut at each angle (no rotates or repeats among them). */
  operations: any[];
}

/**
 * The angles a rotary repeat turns the stock to (degrees, in order); its
 * numbers through `numberOf` (to work out expressions in the editor).
 */
export function repeatAngles(
  repeat: any,
  numberOf: (value: unknown) => number | undefined = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined,
): number[] {
  const steps = Math.max(
    1,
    Math.min(360, Math.floor(numberOf(repeat?.steps) ?? 1)),
  );
  const start = numberOf(repeat?.startAngle) ?? 0;
  const spacing = repeat?.spacing ?? 'turn';
  const step =
    spacing === 'step'
      ? (numberOf(repeat?.stepAngle) ?? 0)
      : spacing === 'range'
        ? steps > 1
          ? ((numberOf(repeat?.endAngle) ?? start) - start) / (steps - 1)
          : 0
        : 360 / steps;
  return Array.from(
    { length: steps },
    (_, k) => Math.round((start + k * step) * 1e6) / 1e6,
  );
}

/** "0°, 90°, 180° and 270°". */
export function anglesLabel(angles: readonly number[]): string {
  const list = angles.map((a) => `${Math.round(a * 1000) / 1000}°`);
  return list.length > 1
    ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
    : (list[0] ?? '');
}

/** The editor's angles: its numbers worked out as the form has them. */
const fieldAngles = (field: FormlyFieldConfig) =>
  repeatAngles(field.model, (value) => numberIn(field, value as any));

const hideUnless =
  (spacing: ModelType['spacing']) => (field: FormlyFieldConfig) =>
    (field.model?.spacing ?? 'turn') !== spacing;

/**
 * The rotary repeat's settings, with `inner` (a list of operations, as the
 * operations list has them) for what it cuts at each angle.
 */
export function rotaryRepeatDefinition(inner: FormlyFieldConfig) {
  const field: FormlyFieldConfig = {
    fieldGroup: [
      {
        key: 'steps',
        type: 'number',
        defaultValue: 4,
        props: { label: 'angles', min: 1, max: 360, required: true },
        validators: { validation: ['whole-number'] },
        expressions: {
          'props.description': (field: FormlyFieldConfig) =>
            `how many times the operations below are cut: at ${anglesLabel(
              fieldAngles(field),
            )}`,
        },
      },
      {
        key: 'spacing',
        type: 'enum',
        defaultValue: 'turn',
        props: {
          label: 'spaced',
          required: true,
          options: [
            { value: 'turn', label: 'evenly round a full turn' },
            { value: 'step', label: 'a set angle apart' },
            { value: 'range', label: 'from the start angle to an end angle' },
          ],
        },
      },
      {
        key: 'startAngle',
        type: 'number',
        defaultValue: 0,
        props: { label: 'start at', description: 'degrees', required: true },
      },
      {
        key: 'stepAngle',
        type: 'number',
        defaultValue: 90,
        props: {
          label: 'apart',
          description: 'degrees between angles',
          required: true,
        },
        expressions: { hide: hideUnless('step') },
      },
      {
        key: 'endAngle',
        type: 'number',
        defaultValue: 180,
        props: {
          label: 'end at',
          description: 'degrees of the last angle',
          required: true,
        },
        expressions: { hide: hideUnless('range') },
      },
      {
        key: 'order',
        type: 'enum',
        defaultValue: 'face',
        props: {
          label: 'order',
          required: true,
          options: [
            { value: 'face', label: 'all operations at each angle in turn' },
            {
              value: 'operation',
              label: 'each operation at every angle (fewer tool changes)',
            },
          ],
        },
      },
      inner,
    ],
    expressions: {
      hide: (field: FormlyFieldConfig) => field.model?.type !== 'rotary-repeat',
    },
  };
  return {
    type: 'rotary-repeat',
    label: 'rotary repeat (4th axis)',
    fieldGroup: field,
  } as const;
}
