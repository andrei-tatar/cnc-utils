import type { ModelType } from '../model-editor/model';
import { snapshot } from '../services/model-store.service';

/**
 * Edits of the project by item id, for the WebMCP tools. Every item of
 * every list (variables, shapes, their transforms and point lists, tools,
 * operations, a rotary repeat's operations, …) has an id; these find it
 * wherever it is. Each returns a new model, leaving the given one alone.
 */

type Item = { id: string; [key: string]: unknown };

/** Where an item is: the list holding it and its place there. */
export type Found = {
  item: Item;
  list: Item[];
  index: number;
  /** Where the list is, e.g. `shapes`, `shapes[2].transforms`. */
  path: string;
};

/** The item with `id` anywhere in `model`; null when there's none. */
export function findItem(model: unknown, id: string): Found | null {
  let found: Found | null = null;
  walkLists(model, '', (list, path) => {
    const index = list.findIndex((item) => item?.id === id);
    if (index !== -1 && !found) {
      found = { item: list[index], list, index, path };
    }
  });
  return found;
}

/** Calls `visit` with every list of items in `value`, outermost first. */
function walkLists(
  value: unknown,
  path: string,
  visit: (list: Item[], path: string) => void,
) {
  if (Array.isArray(value)) {
    if (value.some(isItem)) visit(value as Item[], path);
    value.forEach((v, i) => walkLists(v, `${path}[${i}]`, visit));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      walkLists(v, path ? `${path}.${key}` : key, visit);
    }
  }
}

function isItem(value: unknown): value is Item {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Item).id === 'string'
  );
}

/**
 * `model` with `changes` made to the item `id`: each key set to its value,
 * or, for null, taken off (the field then goes back to its default).
 */
export function updateItem(
  model: ModelType,
  id: string,
  changes: Record<string, unknown>,
): ModelType {
  if ('id' in changes && changes['id'] !== id) {
    throw new Error('An item’s id can’t be changed.');
  }
  const copy = snapshot(model);
  const found = findItem(copy, id);
  if (!found) throw new Error(`There’s no item with id “${id}”.`);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      delete found.item[key];
    } else {
      found.item[key] = snapshot(value);
    }
  }
  return copy;
}

/** `model` with `changes` made to its `stock` or `gcode` settings. */
export function updateSection(
  model: ModelType,
  section: 'stock' | 'gcode',
  changes: Record<string, unknown>,
): ModelType {
  const settings: Record<string, unknown> = { ...(model[section] ?? {}) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      delete settings[key];
    } else {
      settings[key] = snapshot(value);
    }
  }
  return { ...snapshot(model), [section]: settings } as ModelType;
}

/** `model` without the items `ids` (and whatever they hold). */
export function removeItems(model: ModelType, ids: readonly string[]) {
  const copy = snapshot(model);
  const missing = ids.filter((id) => !findItem(copy, id));
  if (missing.length) {
    throw new Error(`There’s no item with id ${missing.join(', ')}.`);
  }
  for (const id of ids) {
    const found = findItem(copy, id);
    found?.list.splice(found.index, 1);
  }
  return copy;
}

/**
 * `model` with the item `id` moved within its list: to `index`, or just
 * before or after another item of the same list.
 */
export function moveItem(
  model: ModelType,
  id: string,
  to: { index?: number; before?: string; after?: string },
): ModelType {
  const copy = snapshot(model);
  const found = findItem(copy, id);
  if (!found) throw new Error(`There’s no item with id “${id}”.`);
  const { list, index, item } = found;
  list.splice(index, 1);
  const other = to.before ?? to.after;
  let at: number;
  if (other !== undefined) {
    const i = list.findIndex((o) => o.id === other);
    if (i === -1) {
      throw new Error(`“${other}” isn’t in the same list as “${id}”.`);
    }
    at = to.before !== undefined ? i : i + 1;
  } else if (typeof to.index === 'number') {
    at = Math.max(0, Math.min(list.length, Math.round(to.index)));
  } else {
    throw new Error('Say where to: index, before or after.');
  }
  list.splice(at, 0, item);
  return copy;
}

/**
 * `model` with `items` put into the list at `path` (`shapes`, `tools`,
 * …), or into the list `key` of the item `parentId` (a shape's
 * `transforms`, a rotary repeat's `operations`); at `index`, else at the
 * end.
 */
export function insertItems(
  model: ModelType,
  where: { list: string; parentId?: string; index?: number },
  items: readonly Item[],
): ModelType {
  const copy = snapshot(model) as unknown as Record<string, unknown>;
  let owner: Record<string, unknown> = copy;
  if (where.parentId !== undefined) {
    const parent = findItem(copy, where.parentId);
    if (!parent) {
      throw new Error(`There’s no item with id “${where.parentId}”.`);
    }
    owner = parent.item;
  } else if (!Array.isArray(copy[where.list])) {
    throw new Error(`The project has no list “${where.list}”.`);
  }
  const list = (owner[where.list] ??= []) as Item[];
  if (!Array.isArray(list)) {
    throw new Error(`“${where.list}” isn’t a list.`);
  }
  const at =
    typeof where.index === 'number'
      ? Math.max(0, Math.min(list.length, Math.round(where.index)))
      : list.length;
  list.splice(at, 0, ...items.map(snapshot));
  return copy as unknown as ModelType;
}

/**
 * Where `model` refers to the items `ids` (outside them): each item whose
 * field holds one of the ids, e.g. an operation's `shapeId`.
 */
export function referencesTo(
  model: ModelType,
  ids: readonly string[],
): { id: string; itemId: string; key: string }[] {
  const wanted = new Set(ids);
  const found: { id: string; itemId: string; key: string }[] = [];
  const visit = (value: unknown, owner: Item | null, key: string) => {
    if (typeof value === 'string') {
      if (owner && wanted.has(value) && key !== 'id' && !wanted.has(owner.id)) {
        found.push({ id: value, itemId: owner.id, key });
      }
    } else if (Array.isArray(value)) {
      value.forEach((v) => visit(v, owner, key));
    } else if (typeof value === 'object' && value !== null) {
      // Inside a removed item, nothing counts.
      if (isItem(value) && wanted.has(value.id)) return;
      const next = isItem(value) ? value : owner;
      for (const [k, v] of Object.entries(value)) {
        visit(v, next, isItem(value) ? k : key);
      }
    }
  };
  visit(model, null, '');
  return found;
}

/**
 * Long strings (imported files: SVG text, pictures as data URLs) stood in
 * for by short placeholders, so reading the project doesn't flood the
 * agent; `restore` puts them back wherever a placeholder comes back.
 */
export class FilePlaceholders {
  static readonly LIMIT = 2000;
  private readonly files = new Map<string, string>();
  private readonly tokens = new Map<string, string>();

  abbreviate<T>(value: T): T {
    if (typeof value === 'string') {
      return (
        value.length > FilePlaceholders.LIMIT ? this.token(value) : value
      ) as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.abbreviate(v)) as T;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.abbreviate(v)]),
      ) as T;
    }
    return value;
  }

  restore<T>(value: T): T {
    if (typeof value === 'string') {
      return (this.files.get(value) ?? value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.restore(v)) as T;
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.restore(v)]),
      ) as T;
    }
    return value;
  }

  private token(file: string): string {
    let token = this.tokens.get(file);
    if (!token) {
      const kind = file.startsWith('data:')
        ? file.slice(0, file.indexOf(',') + 1 || 40)
        : 'text';
      token = `[file #${this.files.size + 1}: ${kind} ${file.length} characters — pass this placeholder back unchanged to keep it]`;
      this.files.set(token, file);
      this.tokens.set(file, token);
    }
    return token;
  }
}
