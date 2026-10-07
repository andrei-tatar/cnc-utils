import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  merge,
  Observable,
  shareReplay,
  Subject,
  switchMap,
} from 'rxjs';
import {
  migrateModel,
  ModelFieldConfig,
  ModelType,
} from '../model-editor/model';
import { sameWork } from '../model-editor/same-work';
import { readModelFromNcFile } from '../project-file';
import { loadTemplate, Template } from '../templates';
import {
  deleteProject,
  getProject,
  listProjects,
  loadProject,
  Project,
  putProject,
} from '../projects';
import { deepEqual, generateId } from '../../util';
import { resolveStock } from '../../cam/stock';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { loadModel, loadProjectId, saveModel } from './model-persistence';
/** Saving waits for a pause in editing (and happens when leaving). */
const SAVE_DELAY = 500;

/**
 * The saved project the work belongs to (opened from or saved as), and its
 * model as saved: null until it's been read.
 */
type SavedProject = { project: Project; model: ModelType | null };

/** The project being edited: the single source of truth for the app. */
@Injectable({ providedIn: 'root' })
export class ModelStore {
  readonly model$ = new BehaviorSubject<ModelType>(loadModel());

  /**
   * The model as it changes. The editor emits a new object on every edit,
   * so changes are compared by value; one subscription is shared by all the
   * pipelines.
   *
   * Compared as a snapshot taken when it was emitted: Formly edits the
   * model it was given (this one) in place, so by the next edit the
   * previous object already matches it. The snapshot copies objects and
   * arrays but shares strings, so a large imported file costs nothing to
   * snapshot or compare (the same string compares equal at once).
   */
  readonly changes$: Observable<ModelType> = this.model$.pipe(
    distinctUntilChanged(deepEqual, snapshot),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /** The saved project the work belongs to; null for unsaved work. */
  private readonly saved$ = new BehaviorSubject<SavedProject | null>(null);

  readonly project$: Observable<Project | null> = this.saved$.pipe(
    map((saved) => saved?.project ?? null),
    distinctUntilChanged(),
  );

  /**
   * Whether there's work that isn't saved as a project: changes since the
   * project was opened or saved (expanding and collapsing items aside), or,
   * for work that isn't a saved project, anything at all.
   */
  readonly pending$: Observable<boolean> = combineLatest([
    this.changes$,
    this.saved$,
  ]).pipe(
    // Replacing the work changes both at once: one answer for the two.
    debounceTime(0),
    map(([model, saved]) => hasPendingWork(model, saved)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** The saved projects, most recent first (see `refreshProjects`). */
  readonly projects$ = new BehaviorSubject<Project[]>([]);

  private open$ = new Subject<void>();

  constructor() {
    this.changes$
      .pipe(debounceTime(SAVE_DELAY))
      .subscribe((model) => this.persist(model));
    // Don't lose an edit still waiting to be saved: when the page is hidden
    // (it may be frozen or discarded without closing) or leaves.
    merge(
      fromEvent(window, 'pagehide'),
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'hidden'),
      ),
    ).subscribe(() => this.persist());

    // A new request cancels one still waiting for its file.
    this.open$
      .pipe(switchMap(() => readModelFromNcFile()))
      .subscribe((model) => this.replace(model, null));

    this.restoreProject(loadProjectId());
    this.refreshProjects();
  }

  get value(): ModelType {
    return this.model$.value;
  }

  set(model: ModelType) {
    this.model$.next(model);
  }

  /** Loads the project embedded in a previously downloaded .nc file. */
  open() {
    this.open$.next();
  }

  /** Replaces the project with an empty one (as on a first visit). */
  clear() {
    this.replace(migrateModel({}), null);
  }

  /** Replaces the project with a template one. */
  async openTemplate(template: Template) {
    this.replace(migrateModel(await loadTemplate(template)), null);
  }

  /** The saved project the work belongs to, if any. */
  get project(): Project | null {
    return this.saved$.value?.project ?? null;
  }

  /** Whether the work has changes that aren't saved as a project. */
  get pending(): boolean {
    return hasPendingWork(this.value, this.saved$.value);
  }

  /** Reads the list of saved projects again (another tab may have changed it). */
  async refreshProjects() {
    this.projects$.next(await listProjects());
  }

  /**
   * Saves the work: under `name` when given (as a new project, or replacing
   * the saved project of that name), otherwise over the project it belongs to.
   */
  async saveProject(name?: string) {
    const model = snapshot(this.value);
    const current = this.project;
    const existing =
      name === undefined
        ? current
        : (await listProjects()).find((project) => project.name === name);
    if (!existing && name === undefined) {
      throw new Error('The work isn’t a saved project yet: give it a name.');
    }
    const project: Project = {
      id: existing?.id ?? (await generateId()),
      name: name ?? existing!.name,
      savedAt: Date.now(),
    };
    await putProject(project, model);
    this.saved$.next({ project, model });
    this.persist();
    await this.refreshProjects();
  }

  /** Replaces the work with a saved project. */
  async openProject(project: Project) {
    const stored = await loadProject(project.id);
    if (stored === undefined) {
      await this.refreshProjects();
      throw new Error(`“${project.name}” is no longer saved.`);
    }
    this.replace(migrateModel(stored), project);
  }

  /**
   * Deletes a saved project. The work stays open; when it was that project,
   * it's now unsaved work.
   */
  async deleteProject(project: Project) {
    await deleteProject(project.id);
    if (this.project?.id === project.id) {
      this.saved$.next(null);
      this.persist();
    }
    await this.refreshProjects();
  }

  /** Puts `model` in place of the work, as the given saved project or none. */
  private replace(model: ModelType, project: Project | null) {
    this.saved$.next(project && { project, model: snapshot(model) });
    this.model$.next(model);
    this.persist();
  }

  /** Keeps the work (and the project it belongs to) for the next visit. */
  private persist(model = this.value) {
    saveModel(model, this.project?.id ?? null);
  }

  /** On start, links the work again to the saved project it belonged to. */
  private async restoreProject(id: string | null) {
    if (!id) return;
    const placeholder: SavedProject = {
      project: { id, name: '', savedAt: 0 },
      model: null,
    };
    this.saved$.next(placeholder);
    const [project, stored] = await Promise.all([
      getProject(id).catch(() => null),
      loadProject(id).catch(() => undefined),
    ]);
    // Something else was opened meanwhile.
    if (this.saved$.value !== placeholder) return;
    this.saved$.next(
      project && stored !== undefined
        ? { project, model: snapshot(migrateModel(stored)) }
        : null,
    );
  }
}

function hasPendingWork(model: ModelType, saved: SavedProject | null) {
  return saved
    ? saved.model !== null &&
        !sameWork(work(model), work(saved.model), ModelFieldConfig)
    : !isEmptyModel(model);
}

/**
 * The model as the pipelines see it, for comparing: stock and G-code options
 * with defaults in place of what's unset (the editor clears hidden fields,
 * `migrateModel()` fills them in).
 */
function work(model: ModelType): ModelType {
  return {
    ...model,
    stock: resolveStock(model.stock),
    gcode: resolveGcodeOptions(model.gcode),
  };
}

/** Whether a model holds no work (as on a first visit). */
function isEmptyModel(model: ModelType): boolean {
  const { variables, shapes, tools, operations } = model;
  return ![variables, shapes, tools, operations].some((list) => list?.length);
}

/** A copy of the objects and arrays in `value`, sharing everything else. */
function snapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(snapshot) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const key in value) {
      copy[key] = snapshot(value[key]);
    }
    return copy as T;
  }
  return value;
}
