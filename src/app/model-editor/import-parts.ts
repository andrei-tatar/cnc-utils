import type { ModelType } from './model';
import { shapeSources } from './shapes/describe';
import { borrowedShapeId } from './operations/describe';
import { flatOperations, NO_TOOL } from './operations/flatten';
import { freeToolIndex } from './tools';

/** What importing parts from another project brings in. */
export type ImportSummary = {
  shapes: number;
  operations: number;
  /** Tools added, and tools of this project used in their place. */
  addedTools: number;
  reusedTools: number;
  variables: number;
  /**
   * Variables the parts use that this project already has (by name): its
   * own value is used.
   */
  sharedVariables: string[];
};

/**
 * The shapes `shapeIds` of `source` copied into `target`, with the shapes
 * they're made from (booleans' operands, copies' originals, nests' parts)
 * and, with `withOperations`, the operations that cut them (clearings and
 * the like with what they belong to; not rotate or flip steps) and those
 * operations' tools — an identical tool of `target` is used instead. The
 * variables their expressions use come along, unless `target` has one of
 * that name. Everything copied gets a new id (`newId`), every reference
 * between them follows; it all goes at the end of `target`'s lists.
 */
export function importParts(
  target: ModelType,
  source: ModelType,
  shapeIds: readonly string[],
  withOperations: boolean,
  newId: () => string,
): { model: ModelType; summary: ImportSummary } {
  const sourceShapes: any[] = source.shapes ?? [];
  // The shapes asked for, and what they're made from, in the source's order.
  const wanted = new Set<string>();
  const stack = [...shapeIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (!id || wanted.has(id)) continue;
    const shape = sourceShapes.find((s) => s.id === id);
    if (!shape) continue;
    wanted.add(id);
    stack.push(...shapeSources(shape));
  }
  const shapes = sourceShapes.filter((s) => wanted.has(s.id));

  const all: any[] = flatOperations(source.operations ?? []);
  const operations = withOperations
    ? all.filter(
        (op) =>
          !NO_TOOL.has(op?.type) &&
          op?.type !== 'flip' &&
          wanted.has(borrowedShapeId(op, all) ?? ''),
      )
    : [];

  // Their tools: this project's identical one, or a copy.
  const toolIds = new Set(operations.map((op) => op.toolId));
  const targetTools: any[] = target.tools ?? [];
  const ids = new Map<string, string>();
  const addedTools: any[] = [];
  let reusedTools = 0;
  for (const tool of (source.tools ?? []) as any[]) {
    if (!toolIds.has(tool.id)) continue;
    const same = targetTools.find((t) => sameTool(t, tool));
    if (same) {
      ids.set(tool.id, same.id);
      reusedTools++;
    } else {
      addedTools.push(tool);
    }
  }

  // The variables their expressions use (and those those use).
  const sourceVariables: any[] = source.variables ?? [];
  const byName = new Map(sourceVariables.map((v) => [v.name, v]));
  const needed = new Set<string>();
  const names = [...identifiers([shapes, operations, addedTools])];
  while (names.length) {
    const name = names.pop()!;
    if (needed.has(name) || !byName.has(name)) continue;
    needed.add(name);
    names.push(...identifiers(byName.get(name)!.value));
  }
  const targetNames = new Set(
    ((target.variables ?? []) as any[]).map((v) => v.name),
  );
  const variables = sourceVariables.filter(
    (v) => needed.has(v.name) && !targetNames.has(v.name),
  );
  const sharedVariables = sourceVariables
    .filter((v) => needed.has(v.name) && targetNames.has(v.name))
    .map((v) => v.name);

  // New ids for everything copied (inside it too: transforms, points…).
  const copied = [shapes, operations, addedTools, variables];
  collectIds(copied, (id) => {
    if (!ids.has(id)) ids.set(id, newId());
  });
  const remapped = remap(copied, ids) as any[][];
  const [newShapes, newOperations, newTools, newVariables] = remapped.map(
    (list) => list.map((item: any) => ({ ...item, expanded: false })),
  );

  // Copied tools keep their number unless it's taken here.
  const tools = [...targetTools];
  for (const tool of newTools) {
    const taken = tools.some((t) => t.index === tool.index);
    tools.push(
      typeof tool.index === 'number' && !taken
        ? tool
        : { ...tool, index: freeToolIndex(tools) },
    );
  }

  return {
    model: {
      ...target,
      variables: [...(target.variables ?? []), ...newVariables],
      shapes: [...(target.shapes ?? []), ...newShapes],
      tools,
      operations: [...(target.operations ?? []), ...newOperations],
    } as ModelType,
    summary: {
      shapes: newShapes.length,
      operations: newOperations.length,
      addedTools: newTools.length,
      reusedTools,
      variables: newVariables.length,
      sharedVariables,
    },
  };
}

/** The same bit: what it is and how it cuts, whatever it's called. */
function sameTool(a: any, b: any): boolean {
  const keys = [
    'bitType',
    'diameter',
    'vAngle',
    'tipDiameter',
    'cornerRadius',
    'pointAngle',
    'headHeight',
  ];
  return keys.every(
    (k) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null),
  );
}

/**
 * The names an expression could use, in every string of `value` (deep):
 * more than it uses (any word), which is harmless — only names of
 * variables count. Long strings (pictures, files) are skipped.
 */
function identifiers(value: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length > 500 || v.startsWith('data:')) return;
      for (const m of v.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) found.add(m[0]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return found;
}

/** Every object's `id` in `value` (deep). */
function collectIds(value: unknown, found: (id: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectIds(v, found));
  } else if (value && typeof value === 'object') {
    const id = (value as any).id;
    if (typeof id === 'string' && id) found(id);
    Object.values(value).forEach((v) => collectIds(v, found));
  }
}

/** `value` with every string that's an id in `ids` replaced (deep copy). */
function remap(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return ids.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => remap(v, ids));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, remap(v, ids)]),
    );
  }
  return value;
}
