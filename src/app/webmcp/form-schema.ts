import type { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * The editor's fields described for an agent (see the `describe_fields`
 * tool): read from the Formly configs, so they're always the fields the
 * editor has.
 */
export type FieldInfo = {
  key: string;
  kind:
    | 'number'
    | 'text'
    | 'boolean'
    | 'choice'
    | 'file'
    | 'font'
    | 'list'
    | 'object';
  label?: string;
  description?: string;
  default?: unknown;
  options?: { value: unknown; label: string }[];
  min?: number;
  max?: number;
  required?: true;
  /**
   * Shown only in some cases (depending on other fields, the tool, the
   * stock): ignored, and dropped, when it doesn't apply.
   */
  conditional?: true;
  /** A list's item fields, an object's fields. */
  fields?: FieldInfo[];
  /** A list of items of several types, described as a list of its own. */
  typedList?: true;
};

/** An item type; for operations, the tool it needs (`tool`). */
export type ItemType = { type: string; label: string; tool?: string };

export type ListSchema = {
  /** Fields every item has. */
  common: FieldInfo[];
  types: ItemType[];
  /** Fields of the asked type, with the common ones. */
  fields?: FieldInfo[];
};

/** Bookkeeping fields an agent never sets. */
const SKIP = new Set(['id', 'expanded']);

/**
 * The field of the list or section `key` in `fields` (the first one found,
 * outermost first: the top-level operations, not a rotary repeat's).
 */
export function findListField(
  fields: readonly FormlyFieldConfig[],
  key: string,
): FormlyFieldConfig | null {
  let level: readonly FormlyFieldConfig[] = fields;
  while (level.length) {
    const found = level.find((f) => f.key === key);
    if (found) return found;
    level = level.flatMap(children);
  }
  return null;
}

/**
 * The items of a list (its `fieldArray`) or a section (its `fieldGroup`):
 * their types, the fields they all have and, for `type`, that type's own.
 * `root` is the project, for fields shown or hidden by it (a rotary
 * axis' settings, say).
 */
export function describeList(
  list: FormlyFieldConfig,
  root: unknown,
  type?: string,
): ListSchema {
  const group =
    list.fieldArray && typeof list.fieldArray === 'object'
      ? (list.fieldArray.fieldGroup ?? [])
      : (list.fieldGroup ?? []);
  const typeField = group.find(
    (f) => f.key === 'type' && Array.isArray(f.props?.options),
  );
  const types: ItemType[] = typeField
    ? (typeField.props!.options as { value: string; label: string }[]).map(
        ({ value, label }) => ({ type: value, label }),
      )
    : [];
  const common: FieldInfo[] = [];
  const own: FieldInfo[] = [];
  for (const field of group) {
    if (field === typeField) continue;
    const shownFor = typesShown(field, types, root, list);
    if (shownFor === 'all' || shownFor === 'unknown') {
      common.push(...describeField(field, shownFor === 'unknown'));
    } else if (type !== undefined && shownFor.includes(type)) {
      // Its type's group: what decides is the type, not conditional.
      own.push(...describeField(field, false, true));
    }
  }
  return type === undefined
    ? { common, types }
    : { common, types, fields: [...common, ...own] };
}

/**
 * Which item types show `field`: all of them, some, or unknown (it
 * depends on something besides the type).
 */
function typesShown(
  field: FormlyFieldConfig,
  types: ItemType[],
  root: unknown,
  list: FormlyFieldConfig,
): 'all' | 'unknown' | string[] {
  const hide = field.expressions?.['hide'] ?? field.hideExpression;
  if (typeof hide !== 'function' || !types.length) {
    return hide ? 'unknown' : 'all';
  }
  const shown: string[] = [];
  for (const { type } of types) {
    const item = {
      model: { type },
      props: { ...field.props },
      options: { formState: {} },
      parent: {
        model: { type },
        parent: { model: [], props: list.props, parent: { model: root } },
      },
    } as unknown as FormlyFieldConfig;
    try {
      if (!(hide as (f: FormlyFieldConfig) => boolean)(item)) {
        shown.push(type);
      }
    } catch {
      return 'unknown';
    }
  }
  return shown.length === types.length
    ? 'all'
    : shown.length
      ? shown
      : 'unknown';
}

/** A field as `FieldInfo` (several, for a group without a key). */
function describeField(
  field: FormlyFieldConfig,
  conditional: boolean,
  ownGroup = false,
): FieldInfo[] {
  // A type's own group isn't conditional itself: its hide is the type.
  const hidden =
    conditional ||
    (!ownGroup && !!(field.expressions?.['hide'] ?? field.hideExpression));
  if (field.key === undefined || field.key === null) {
    return (field.fieldGroup ?? []).flatMap((f) => describeField(f, hidden));
  }
  const key = String(field.key);
  if (SKIP.has(key)) return [];
  const kind = kindOf(field);
  if (!kind) return [];
  const props = field.props ?? {};
  const info: FieldInfo = { key, kind };
  if (typeof props.label === 'string' && props.label) {
    info.label = props.label;
  }
  if (typeof props.description === 'string' && props.description) {
    info.description = props.description;
  }
  if (
    field.defaultValue !== undefined &&
    typeof field.defaultValue !== 'function'
  ) {
    info.default = field.defaultValue;
  }
  if (Array.isArray(props.options)) {
    info.options = (props.options as { value: unknown; label: string }[]).map(
      ({ value, label }) => ({ value, label }),
    );
  }
  const min = props.min ?? props['numberMin'];
  const max = props.max ?? props['numberMax'];
  if (typeof min === 'number') info.min = min;
  if (typeof max === 'number') info.max = max;
  if (props.required) info.required = true;
  if (hidden) info.conditional = true;
  if (kind === 'list') {
    const items =
      field.fieldArray && typeof field.fieldArray === 'object'
        ? (field.fieldArray.fieldGroup ?? [])
        : [];
    if (
      items.some((f) => f.key === 'type' && Array.isArray(f.props?.options))
    ) {
      info.typedList = true;
    } else {
      info.fields = items.flatMap((f) => describeField(f, false));
    }
  } else if (kind === 'object') {
    info.fields = (field.fieldGroup ?? []).flatMap((f) =>
      describeField(f, false),
    );
  }
  return [info];
}

function kindOf(field: FormlyFieldConfig): FieldInfo['kind'] | null {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'input':
    case 'textarea':
      return 'text';
    case 'boolean':
    case 'checkbox':
      return 'boolean';
    case 'enum':
    case 'select':
    case 'radio':
      return 'choice';
    case 'file':
      return 'file';
    case 'font':
      return 'font';
    case 'repeat':
      return 'list';
    case 'section':
      return 'object';
    case 'hidden':
      // The header's toggles (hidden, disabled); not ids and the like.
      return typeof field.defaultValue === 'boolean' ? 'boolean' : null;
    default:
      return field.fieldGroup ? 'object' : null;
  }
}

/** The fields under `field`, inside lists' items too. */
function children(field: FormlyFieldConfig): FormlyFieldConfig[] {
  const items =
    field.fieldArray && typeof field.fieldArray === 'object'
      ? (field.fieldArray.fieldGroup ?? [])
      : [];
  return [...(field.fieldArray ? [] : (field.fieldGroup ?? [])), ...items];
}
