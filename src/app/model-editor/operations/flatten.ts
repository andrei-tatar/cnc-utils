/** The operation type that holds a list of operations of its own. */
export const ROTARY_REPEAT = 'rotary-repeat';

/** Types that cut nothing themselves: no tool, no shape. */
export const NO_TOOL = new Set(['rotate', ROTARY_REPEAT]);

/**
 * Every operation, those inside a rotary repeat right after it, in list
 * order: what looking one up by id (or what comes before it) goes through.
 */
export function flatOperations<T>(operations: readonly T[] | undefined): T[] {
  return (operations ?? []).flatMap((op: any) =>
    op?.type === ROTARY_REPEAT ? [op, ...(op.operations ?? [])] : [op],
  );
}

/** The rotary repeat the operation with `id` is inside of, if any. */
export function repeatOf<T>(
  id: string | undefined,
  operations: readonly T[] | undefined,
): T | null {
  return (
    (operations ?? []).find(
      (op: any) =>
        op?.type === ROTARY_REPEAT &&
        (op.operations ?? []).some((inner: any) => inner?.id === id),
    ) ?? null
  );
}

/**
 * The operations that cut, in list order: enabled ones (not inside a
 * disabled rotary repeat), rotate steps and repeats themselves left out.
 */
export function cutOperations<T>(operations: readonly T[] | undefined): T[] {
  return (operations ?? []).flatMap((op: any) =>
    op?.disabled
      ? []
      : op?.type === ROTARY_REPEAT
        ? (op.operations ?? []).filter((inner: any) => !inner?.disabled)
        : NO_TOOL.has(op?.type)
          ? []
          : [op],
  );
}
