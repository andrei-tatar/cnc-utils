import { FormlyFieldConfig } from '@ngx-formly/core';
import { deepEqual } from '../../util';

/**
 * The default values of a level of the model, by key (a key can have more
 * than one: each variant sharing it has its own), and the same for its
 * objects and lists' items.
 */
type DefaultsSchema = {
  defaults: Map<string, unknown[]>;
  objects: Map<string, DefaultsSchema>;
  lists: Map<string, DefaultsSchema>;
};

const schemas = new WeakMap<FormlyFieldConfig[], DefaultsSchema>();

function defaultsSchema(fields: FormlyFieldConfig[]): DefaultsSchema {
  let schema = schemas.get(fields);
  if (!schema) {
    schema = { defaults: new Map(), objects: new Map(), lists: new Map() };
    fields.forEach((field) => addField(schema!, field));
    schemas.set(fields, schema);
  }
  return schema;
}

function addField(schema: DefaultsSchema, field: FormlyFieldConfig) {
  const key = field.key;
  if (key === undefined || key === null) {
    // A group (a shape type's settings, a box): its fields are on this level.
    field.fieldGroup?.forEach((child) => addField(schema, child));
    return;
  }
  const name = String(key);
  if (field.defaultValue !== undefined) {
    schema.defaults.set(name, [
      ...(schema.defaults.get(name) ?? []),
      field.defaultValue,
    ]);
  }
  if (field.fieldArray && typeof field.fieldArray === 'object') {
    merge(schema.lists, name, field.fieldArray.fieldGroup ?? []);
  } else if (field.fieldGroup) {
    merge(schema.objects, name, field.fieldGroup);
  }
}

/** The same key can be used by more than one variant: take all of them. */
function merge(
  into: Map<string, DefaultsSchema>,
  key: string,
  fields: FormlyFieldConfig[],
) {
  const extra = defaultsSchema(fields);
  const existing = into.get(key);
  if (!existing) {
    into.set(key, extra);
    return;
  }
  const defaults = new Map(existing.defaults);
  extra.defaults.forEach((values, name) =>
    defaults.set(name, [...(defaults.get(name) ?? []), ...values]),
  );
  into.set(key, {
    defaults,
    objects: new Map([...existing.objects, ...extra.objects]),
    lists: new Map([...existing.lists, ...extra.lists]),
  });
}

/**
 * Whether two models hold the same work, as far as the user is concerned.
 * Differences that only come from the editor are ignored: which items are
 * expanded, properties set to undefined, and a field's default value where
 * the other model doesn't have the field (the editor fills defaults in for
 * fields a model was saved without, e.g. ones added since).
 */
export function sameWork(
  x: unknown,
  y: unknown,
  fields: FormlyFieldConfig[],
): boolean {
  return same(x, y, defaultsSchema(fields));
}

function same(x: unknown, y: unknown, schema: DefaultsSchema | null): boolean {
  if (x === y) {
    return true;
  }
  if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) {
    return false;
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    return (
      Array.isArray(x) &&
      Array.isArray(y) &&
      x.length === y.length &&
      x.every((item, i) => same(item, y[i], schema))
    );
  }
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'expanded') {
      continue;
    }
    const [u, v] = [a[key], b[key]];
    if (u === undefined || v === undefined) {
      const value = u === undefined ? v : u;
      if (
        value !== undefined &&
        !schema?.defaults.get(key)?.some((d) => deepEqual(d, value))
      ) {
        return false;
      }
      continue;
    }
    const nested = Array.isArray(u)
      ? schema?.lists.get(key)
      : schema?.objects.get(key);
    if (!same(u, v, nested ?? null)) {
      return false;
    }
  }
  return true;
}
