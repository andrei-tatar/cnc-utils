import type { FormlyFieldConfig } from '@ngx-formly/core';
import { evaluateNumber, evaluateVariables, Variables } from './evaluate';

/**
 * Where the number fields are in a model, read from its form: the keys of
 * number fields, of nested settings and of lists, at each level.
 */
type NumberSchema = {
  numbers: Set<string>;
  objects: Map<string, NumberSchema>;
  lists: Map<string, NumberSchema>;
};

const schemas = new WeakMap<object, NumberSchema>();

/** The number fields in `fields` (read once per field config). */
export function numberSchema(fields: FormlyFieldConfig[]): NumberSchema {
  let schema = schemas.get(fields);
  if (!schema) {
    schema = { numbers: new Set(), objects: new Map(), lists: new Map() };
    for (const field of fields) {
      addField(schema, field);
    }
    schemas.set(fields, schema);
  }
  return schema;
}

function addField(schema: NumberSchema, field: FormlyFieldConfig) {
  const key = field.key;
  if (key === undefined || key === null) {
    // A group (a shape type's settings, a box): its fields are on this level.
    field.fieldGroup?.forEach((child) => addField(schema, child));
    return;
  }
  const name = String(key);
  if (field.type === 'number') {
    schema.numbers.add(name);
  } else if (field.fieldArray && typeof field.fieldArray === 'object') {
    merge(schema.lists, name, field.fieldArray.fieldGroup ?? []);
  } else if (field.fieldGroup) {
    merge(schema.objects, name, field.fieldGroup);
  }
}

/** The same key can be used by more than one variant: take all of them. */
function merge(
  into: Map<string, NumberSchema>,
  key: string,
  fields: FormlyFieldConfig[],
) {
  const existing = into.get(key);
  if (!existing) {
    into.set(key, numberSchema(fields));
    return;
  }
  const extra = numberSchema(fields);
  into.set(key, {
    numbers: new Set([...existing.numbers, ...extra.numbers]),
    objects: new Map([...existing.objects, ...extra.objects]),
    lists: new Map([...existing.lists, ...extra.lists]),
  });
}

/**
 * `value` with every number field's expression replaced by its value (or
 * `null`, like an empty field, when it can't be worked out). Everything
 * else, strings included, is shared with `value`.
 *
 * `forDisplay` (labels): values are rounded, and an expression that can't
 * be worked out is kept as typed.
 */
export function resolveNumbers<T>(
  value: T,
  schema: NumberSchema,
  variables: Variables,
  forDisplay = false,
): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const resolved = { ...value } as Record<string, unknown>;
  for (const key of schema.numbers) {
    const input = resolved[key];
    if (typeof input === 'string') {
      const result = evaluateNumber(input, variables);
      resolved[key] =
        result && 'value' in result
          ? forDisplay
            ? Math.round(result.value * 1e4) / 1e4
            : result.value
          : forDisplay
            ? input
            : null;
    }
  }
  for (const [key, nested] of schema.objects) {
    resolved[key] = resolveNumbers(
      resolved[key],
      nested,
      variables,
      forDisplay,
    );
  }
  for (const [key, item] of schema.lists) {
    const list = resolved[key];
    if (Array.isArray(list)) {
      resolved[key] = list.map((entry) =>
        resolveNumbers(entry, item, variables, forDisplay),
      );
    }
  }
  return resolved as T;
}

/**
 * The model as the pipelines use it: the variables worked out (in order)
 * and put in place of the expressions in every number field.
 */
export function resolveModel<
  T extends { variables?: Array<{ id: string; value: unknown }> },
>(model: T, fields: FormlyFieldConfig[]): T {
  const variables = evaluateVariables(model.variables as any);
  const resolved = resolveNumbers(model, numberSchema(fields), variables);
  return {
    ...resolved,
    variables: (model.variables ?? []).map((variable) => {
      const result = variables.byId.get(variable.id);
      return {
        ...variable,
        value: result && 'value' in result ? result.value : null,
      };
    }),
  };
}
