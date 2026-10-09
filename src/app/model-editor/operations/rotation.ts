import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { flatOperations, repeatOf } from './flatten';
import { repeatAngles } from './operation-rotary-repeat';

/**
 * Operations that must cut where the one they belong to cut, so with the
 * stock turned as it was: the key naming that one. (Inlay and flat plugs
 * are cut in another board.)
 */
const FOLLOWS: Record<string, string> = {
  'v-carve-clear': 'vcarveOperationId',
  rest: 'pocketOperationId',
  'image-engrave-clear': 'engraveOperationId',
};

/** A number, or undefined (to work out expressions in the editor). */
type NumberOf = (value: unknown) => number | undefined;
const plainNumber: NumberOf = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * How far the stock on the rotary axis is turned for an operation of the
 * list (degrees): the angle of the last enabled rotate above it, 0 with
 * none (or one that can't be worked out). Rotary repeats in between don't
 * count: they turn it back for what comes after.
 */
export function operationRotation(
  operation: any,
  operations: readonly any[],
  numberOf: NumberOf = plainNumber,
): number {
  const at = operations.findIndex((o) => o?.id === operation?.id);
  for (let i = at - 1; i >= 0; i--) {
    const op = operations[i];
    if (op?.type === 'rotate' && !op.disabled) {
      return numberOf(op.angle) ?? 0;
    }
  }
  return 0;
}

/**
 * Every angle an operation is cut at (degrees): those of the rotary repeat
 * it's inside of (none while that's disabled), or its one rotation.
 */
export function operationAngles(
  operation: any,
  operations: readonly any[],
  numberOf: NumberOf = plainNumber,
): number[] {
  const repeat = repeatOf(operation?.id, operations);
  if (repeat) {
    return repeat.disabled ? [] : repeatAngles(repeat, numberOf);
  }
  return [operationRotation(operation, operations, numberOf)];
}

/**
 * Which way up the stock is for an operation's cuts, as a key: operations
 * with the same key cut in the same frame (they share tabs): those inside
 * one rotary repeat, or those turned to the same angle.
 */
export function operationFrame(
  operation: any,
  operations: readonly any[],
): string {
  const repeat: any = repeatOf(operation?.id, operations);
  if (repeat) {
    return `repeat ${repeat.id}`;
  }
  const angle = operationRotation(operation, operations);
  return `angle ${Math.round((((angle % 360) + 360) % 360) * 1e6) / 1e6}`;
}

/**
 * For an operation that must be cut with the stock turned as the one it
 * belongs to was (clearings, rest machining): that one, when the stock
 * isn't turned the same for both. Null otherwise.
 */
export function rotationMismatch(
  operation: any,
  operations: readonly any[],
): { other: any; angles: number[]; otherAngles: number[] } | null {
  const key = FOLLOWS[operation?.type];
  const other =
    key && flatOperations(operations).find((o) => o?.id === operation[key]);
  if (
    !other ||
    operationFrame(operation, operations) === operationFrame(other, operations)
  ) {
    return null;
  }
  return {
    other,
    angles: operationAngles(operation, operations),
    otherAngles: operationAngles(other, operations),
  };
}

/** Whether the stock is held on a rotary axis, from any field. */
export function onRotary(field: FormlyFieldConfig | undefined): boolean {
  const stock = rootModel(field)?.stock;
  return !!stock?.enabled && stock?.mount === 'rotary';
}
