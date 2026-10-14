import type { ModelType } from './model';

/**
 * Projects are stored with the version of the format they were written in
 * (`version`, on the stored copy only: the editor's model doesn't carry it),
 * and brought up to the current one when they're read: wherever a project
 * comes from (the open project's storage, saved projects, a .nc file, a
 * share link, a template), it goes through `migrateModel()`, and wherever
 * one is written, through `storedModel()`.
 *
 * To change the format: add a migration at the end of `MIGRATIONS` that
 * turns a project of the version before into the new one. `MODEL_VERSION`
 * follows. A migration never changes once released — projects of every
 * version since are read through it.
 */

/**
 * Turns a stored project of one version into the next. It gets the stored
 * object to change (nothing else holds it) and returns the result, which
 * may be the same object. Older formats aren't typed: it reads what it
 * needs as `any`.
 */
export type Migration = (model: any) => any;

/**
 * The migrations, in order: `MIGRATIONS[i]` takes a project of version
 * `i + 1` to version `i + 2`.
 */
const MIGRATIONS: Migration[] = [
  // 1 → 2: rest machining has its own depths, leave stock and overlap;
  // until then it took the first three from its pocket, with no overlap.
  (model) => {
    const all = (model.operations ?? []).flatMap((op: any) =>
      op?.type === 'rotary-repeat' ? [op, ...(op.operations ?? [])] : [op],
    );
    for (const op of all) {
      if (op?.type !== 'rest') continue;
      const pocket = all.find(
        (o: any) => o?.id === op.pocketOperationId && o?.type === 'pocket',
      );
      for (const key of [
        'startDepth',
        'depthMode',
        'depth',
        'steps',
        'leaveStock',
      ]) {
        if (pocket?.[key] !== undefined) {
          op[key] ??= pocket[key];
        }
      }
      op.restOverlap ??= 0;
    }
    return model;
  },
];

/**
 * The version of the format projects are written in. Projects saved before
 * versions were kept have none, and are version 1.
 */
export const MODEL_VERSION = 1 + MIGRATIONS.length;

/** A project written by a newer version of the app than this one. */
export class NewerProjectError extends Error {
  constructor(
    readonly version: number,
    latest = MODEL_VERSION,
  ) {
    super(
      `it was saved by a newer version of the app (project format ${version}, ` +
        `this version reads up to ${latest}): reload the page to update`,
    );
    this.name = 'NewerProjectError';
  }
}

/** `model` as it's stored: with the version of its format. */
export function storedModel(model: ModelType): ModelType & { version: number } {
  return { ...model, version: MODEL_VERSION };
}

/**
 * A stored project in the current format, without its `version`. Throws
 * when it isn't a project, or when it's of a newer version than this app
 * reads (`NewerProjectError`).
 */
export function migrateModel(stored: unknown): ModelType {
  return migrate(stored, MIGRATIONS);
}

/** `migrateModel` over the given migrations (the specs try out their own). */
export function migrate(stored: unknown, migrations: Migration[]): ModelType {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    throw new Error('it holds no project');
  }
  const { version = 1, ...model } = stored as { version?: unknown };
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error(`it holds a project of an unknown version (${version})`);
  }
  const latest = 1 + migrations.length;
  if (version > latest) {
    throw new NewerProjectError(version, latest);
  }
  let migrated: any = model;
  for (let v = version; v < latest; v++) {
    migrated = migrations[v - 1](migrated);
  }
  return migrated as ModelType;
}
