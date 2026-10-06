import {
  evaluateExpression,
  ExpressionError,
  isIdentifier,
  RESERVED_NAMES,
} from './expression';

/** A named value (a number or an expression) for any number field. */
export type VariableType = {
  id: string;
  name: string;
  /** A number, or an expression using the variables above this one. */
  value: number | string | null;
};

/** A number field's value: a number, an expression, or nothing yet. */
export type NumberInput = number | string | null | undefined;

export type Evaluated = { value: number } | { error: string };

/** The variables, worked out in order. */
export type Variables = {
  /** The usable ones, by name. */
  scope: ReadonlyMap<string, number>;
  /** Each variable's value or what's wrong with it, by id. */
  byId: ReadonlyMap<string, Evaluated & { nameError?: string }>;
  /** Names of variables that have a problem (or come later). */
  unusable: ReadonlyMap<string, string>;
};

const EMPTY: Variables = {
  scope: new Map(),
  byId: new Map(),
  unusable: new Map(),
};

let cache: { key: string; result: Variables } | undefined;

/**
 * Works out the variables in order: each can use the ones above it.
 * Remembers the last result, as every number field asks on every edit.
 */
export function evaluateVariables(
  variables: VariableType[] | undefined,
): Variables {
  if (!variables?.length) {
    return EMPTY;
  }
  const key = JSON.stringify(variables.map((v) => [v?.id, v?.name, v?.value]));
  if (cache?.key !== key) {
    cache = { key, result: evaluateInOrder(variables) };
  }
  return cache.result;
}

function evaluateInOrder(variables: VariableType[]): Variables {
  const scope = new Map<string, number>();
  const byId = new Map<string, Evaluated & { nameError?: string }>();
  // Until a variable is reached, using it means it's defined further down.
  const unusable = new Map<string, string>();
  for (const variable of variables) {
    const name = variable?.name?.trim();
    if (name) {
      unusable.set(name, `“${name}” is defined further down`);
    }
  }

  const seen = new Set<string>();
  for (const variable of variables) {
    if (!variable) continue;
    const name = variable.name?.trim() ?? '';
    const nameError = !name
      ? 'Required'
      : !isIdentifier(name)
        ? 'Letters, digits and _ only, not starting with a digit'
        : RESERVED_NAMES.has(name)
          ? `“${name}” is a built-in name`
          : seen.has(name)
            ? `There is already a “${name}” above`
            : undefined;
    seen.add(name);

    if (!nameError) {
      unusable.set(name, `“${name}” can’t use itself`);
    }
    const evaluated = evaluateNumber(variable.value, {
      scope,
      byId,
      unusable,
    }) ?? { error: 'Required' };
    byId.set(variable.id, nameError ? { ...evaluated, nameError } : evaluated);

    if (nameError) {
      continue;
    }
    if ('value' in evaluated) {
      scope.set(name, evaluated.value);
      unusable.delete(name);
    } else {
      unusable.set(name, `“${name}” has an error`);
    }
  }
  return { scope, byId, unusable };
}

/**
 * A number field's value with the variables in place; `null` when the field
 * is empty.
 */
export function evaluateNumber(
  input: NumberInput,
  variables: Variables,
): Evaluated | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input)
      ? { value: input }
      : { error: 'Not a number' };
  }
  try {
    return { value: evaluateExpression(String(input), variables.scope) };
  } catch (e) {
    if (!(e instanceof ExpressionError)) {
      throw e;
    }
    const unusable = e.unknownName && variables.unusable.get(e.unknownName);
    return { error: unusable || e.message };
  }
}
