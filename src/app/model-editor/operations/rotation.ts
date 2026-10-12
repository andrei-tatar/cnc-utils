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
  'relief-rough': 'reliefOperationId',
};

/**
 * Whether an operation of `type` cuts where another one does (clearings,
 * rest machining), so is turned and wrapped as that one is.
 */
export function belongsToAnother(type: string | undefined): boolean {
  return !!type && type in FOLLOWS;
}

/**
 * Whether an operation is wrapped round a round stock: its own `wrap`, or,
 * for one that cuts where another does, that one's (a clearing always cuts
 * where its engraving or v-carve does). `operations` as `flatOperations`
 * gives them.
 */
export function operationWrap(
  operation: any,
  operations: readonly any[],
  depth = 0,
): boolean {
  const key = FOLLOWS[operation?.type];
  if (!key) return !!operation?.wrap;
  const other = operations.find((o) => o?.id === operation[key]);
  return depth < 3 && !!other && operationWrap(other, operations, depth + 1);
}

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
 * one rotary repeat, or those turned to the same angle, on the same side
 * of the board.
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
  const side = onBack(operation, operations) ? ' back' : '';
  return `angle ${Math.round((((angle % 360) + 360) % 360) * 1e6) / 1e6}${side}`;
}

/**
 * The way a two-sided job turns the board over: along the axis the first
 * enabled flip step says (every flip turns it the same way). Null without
 * one, or without a stock on the table to turn over.
 */
export function jobFlip(
  operations: readonly any[] | undefined,
  stock: { enabled?: boolean; mount?: string } | undefined,
): 'x' | 'y' | null {
  if (!stock?.enabled || stock.mount === 'rotary') {
    return null;
  }
  const first = (operations ?? []).find(
    (o: any) => o?.type === 'flip' && !o.disabled,
  );
  return first ? (first.flipAlong === 'y' ? 'y' : 'x') : null;
}

/**
 * Whether an operation of the list is cut on the board's back: below an
 * odd number of enabled flip steps. (A flip step's own dowel holes are
 * drilled before it turns the board.)
 */
export function onBack(operation: any, operations: readonly any[]): boolean {
  let back = false;
  for (const op of operations ?? []) {
    if (op?.id === operation?.id) break;
    if (op?.type === 'flip' && !op.disabled) back = !back;
  }
  return back;
}

/** Whether the stock lies on the table (and is set), from any field. */
export function onTable(field: FormlyFieldConfig | undefined): boolean {
  const stock = rootModel(field)?.stock;
  return !!stock?.enabled && stock?.mount !== 'rotary';
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
