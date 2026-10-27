import type { VariableType } from './evaluate';

/**
 * The variables of `variables` that the expressions in `value` use, and
 * those those use, in their order (so each still comes after the ones it
 * uses). Any word in a string counts, which may keep one too many — never
 * one too few.
 */
export function variablesUsedBy<T extends Pick<VariableType, 'name' | 'value'>>(
  variables: readonly T[],
  value: unknown,
): T[] {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const needed = new Set<string>();
  const names = [...identifiers(value)];
  while (names.length) {
    const name = names.pop()!;
    if (needed.has(name) || !byName.has(name)) continue;
    needed.add(name);
    names.push(...identifiers(byName.get(name)!.value));
  }
  return variables.filter((v) => needed.has(v.name));
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
