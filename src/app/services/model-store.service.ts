import { inject, Injectable } from '@angular/core';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  EMPTY,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  fromEvent,
  map,
  merge,
  Observable,
  race,
  shareReplay,
  Subject,
  switchMap,
  timer,
} from 'rxjs';
import { emptyModel, ModelFieldConfig, ModelType } from '../model-editor/model';
import { sameWork } from '../model-editor/same-work';
import { variablesUsedBy } from '../model-editor/variables/used';
import { readModelFromNcFile } from '../project-file';
import { loadTemplate, Template } from '../templates';
import {
  deleteProject,
  getProject,
  listProjects,
  loadProject,
  Project,
  putProject,
  sameProject,
} from '../projects';
import { CloudProjects } from '../projects/cloud-projects.service';
import { deepEqual, generateId } from '../../util';
import { resolveStock } from '../../cam/stock';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { loadModel, loadProjectRef, saveModel } from './model-persistence';
import { reportError } from '../pipeline/errors';
/** Saving waits for a pause in editing (and happens when leaving). */
const SAVE_DELAY = 500;
/**
 * How long starting waits to hear from Firebase about the project the work
 * belongs to (it's linked whenever that comes, also later).
 */
const CLOUD_WAIT = 5000;

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

  /** The projects saved in this browser, most recent first (see `refreshProjects`). */
  readonly projects$ = new BehaviorSubject<Project[]>([]);

  /** Projects kept in Firebase: who's signed in, and their list. */
  readonly cloud = inject(CloudProjects);
  /** Changes to saved projects under way: no time to follow Firebase's. */
  private writes = 0;
  /** The project whose newer copy is being read from Firebase. */
  private following: SavedProject | null = null;

  /**
   * The work was replaced (opened, loaded, new): not edited, so the preview
   * should frame it afresh.
   */
  readonly replaced$ = new Subject<void>();

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

    // A new request cancels one still waiting for its file. A file that
    // can't be read is reported; the next request tries again.
    this.open$
      .pipe(
        switchMap(() =>
          readModelFromNcFile().pipe(
            catchError((error) => {
              reportError('opening the .nc file', error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((model) => this.replace(model, null));

    this.ready = this.restoreProject(loadProjectRef());
    this.refreshProjects();
    merge(this.cloud.user$, this.cloud.projects$).subscribe(() =>
      this.followCloud(),
    );
  }

  /**
   * Settles once the work is linked again to the saved project it belonged
   * to (on start): until then, whether it has unsaved changes isn't known.
   */
  readonly ready: Promise<void>;

  get value(): ModelType {
    return this.model$.value;
  }

  set(model: ModelType) {
    this.model$.next(model);
  }

  /**
   * Puts an earlier state of the same work back (undo / redo): unlike
   * opening something, it stays the same project and isn't framed afresh.
   */
  restore(model: ModelType) {
    this.model$.next(snapshot(model));
  }

  /** Loads the project embedded in a previously downloaded .nc file. */
  open() {
    this.open$.next();
  }

  /**
   * Replaces the project with an empty one (as on a first visit), keeping
   * its tools and / or G-code options when asked to, with the variables
   * their expressions use.
   */
  clear(keep: { tools?: boolean; gcode?: boolean } = {}) {
    const model = emptyModel();
    if (keep.tools) model.tools = snapshot(this.value.tools ?? []);
    if (keep.gcode) model.gcode = snapshot(this.value.gcode);
    model.variables = snapshot(
      variablesUsedBy(this.value.variables ?? [], [model.tools, model.gcode]),
    );
    this.replace(model, null);
  }

  /** Replaces the project with one read from a .nc file (a dropped one). */
  openFile(model: ModelType) {
    this.replace(model, null);
  }

  /** Replaces the project with one from a share link. */
  openShared(model: ModelType) {
    this.replace(model, null);
  }

  /** Replaces the project with a template one. */
  async openTemplate(template: Template) {
    this.replace(await loadTemplate(template), null);
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
   * the saved project of that name) — in this browser, or in Firebase with
   * `cloud` —, otherwise over the project it belongs to, where that is.
   */
  async saveProject(name?: string, cloud = false) {
    const model = snapshot(this.value);
    const current = this.project;
    if (name === undefined) {
      cloud = !!current?.cloud;
    }
    await this.writing(async () => {
      const existing =
        name === undefined
          ? current
          : (await this.savedIn(cloud)).find((p) => p.name === name);
      if (!existing && name === undefined) {
        throw new Error('The work isn’t a saved project yet: give it a name.');
      }
      const project = await this.put(
        {
          id: existing?.id ?? (await generateId()),
          name: name ?? existing!.name,
          savedAt: Date.now(),
        },
        cloud,
        model,
      );
      this.saved$.next({ project, model });
      this.persist();
    });
    await this.refreshProjects();
  }

  /** Replaces the work with a saved project. */
  async openProject(project: Project) {
    const stored = await this.stored(project);
    if (stored === undefined) {
      await this.refreshProjects();
      throw new Error(`“${project.name}” is no longer saved.`);
    }
    this.replace(stored, project);
  }

  /**
   * Deletes a saved project. The work stays open; when it was that project,
   * it's now unsaved work.
   */
  async deleteProject(project: Project) {
    await this.writing(async () => {
      await this.remove(project);
      if (sameProject(this.project, project)) {
        this.saved$.next(null);
        this.persist();
      }
    });
    await this.refreshProjects();
  }

  /**
   * Copies a project saved in this browser to Firebase, or one there to
   * this browser — in place of the project of its name there, if any — and,
   * to `move` it, deletes it where it was. Work that belongs to the moved
   * project belongs to it where it is now.
   */
  async transferProject(project: Project, move: boolean) {
    const toCloud = !project.cloud;
    await this.writing(async () => {
      const model = await this.stored(project);
      if (model === undefined) {
        throw new Error(`“${project.name}” is no longer saved.`);
      }
      const replaced = (await this.savedIn(toCloud)).find(
        (p) => p.name === project.name,
      );
      const copy = await this.put(
        {
          id: replaced?.id ?? (await generateId()),
          name: project.name,
          savedAt: project.savedAt,
        },
        toCloud,
        model,
      );
      const open = this.saved$.value;
      if (replaced && sameProject(open?.project ?? null, replaced)) {
        // The work is now changes to what was put in its project's place.
        this.saved$.next({ project: copy, model: snapshot(model) });
      }
      if (move) {
        await this.remove(project);
        if (open && sameProject(open.project, project)) {
          this.saved$.next({ project: copy, model: open.model });
        }
      }
      this.persist();
    });
    await this.refreshProjects();
  }

  /** The projects saved in this browser, or those in Firebase. */
  private async savedIn(cloud: boolean): Promise<Project[]> {
    return cloud ? (this.cloud.projects$.value ?? []) : listProjects();
  }

  private stored(project: Project): Promise<ModelType | undefined> {
    return project.cloud
      ? this.cloud.load(project.id)
      : loadProject(project.id);
  }

  /** Saves a project in this browser or in Firebase; gives it as it's there. */
  private async put(
    { id, name, savedAt }: Project,
    cloud: boolean,
    model: ModelType,
  ): Promise<Project> {
    const project: Project = cloud
      ? { id, name, savedAt, cloud: true }
      : { id, name, savedAt };
    await (cloud ? this.cloud.put(project, model) : putProject(project, model));
    return project;
  }

  private remove(project: Project): Promise<void> {
    return project.cloud
      ? this.cloud.delete(project.id)
      : deleteProject(project.id);
  }

  /**
   * Runs a change to the saved projects; what Firebase tells meanwhile (its
   * list changes as soon as something is written to it, before the work is
   * linked to what was written) is looked at once it's done.
   */
  private async writing(change: () => Promise<void>) {
    this.writes++;
    try {
      await change();
    } finally {
      this.writes--;
      this.followCloud();
    }
  }

  /**
   * Keeps work that belongs to a project in Firebase in step with it, as
   * who's signed in and their list change: another browser may save, rename
   * or delete it. A newer copy takes the work's place, unless there are
   * changes here (saving then writes over the other browser's); with the
   * project gone, or nobody signed in, the work stays open as unsaved work.
   * On start it's what links the work to its project again.
   */
  private followCloud() {
    const saved = this.saved$.value;
    const user = this.cloud.user$.value;
    const projects = this.cloud.projects$.value;
    if (!saved?.project.cloud || this.writes || user === undefined) return;
    if (user && !projects) return;
    const remote = projects?.find((p) => p.id === saved.project.id);
    if (!remote) {
      this.saved$.next(null);
      this.persist();
      return;
    }
    if (saved.model !== null) {
      const unchanged = remote.savedAt === saved.project.savedAt;
      if (unchanged || this.pending) {
        if (!unchanged || remote.name !== saved.project.name) {
          this.saved$.next({ project: remote, model: saved.model });
          this.persist();
        }
        return;
      }
    }
    if (this.following === saved) return;
    this.following = saved;
    this.cloud
      .load(remote.id)
      .then((model) => {
        this.following = null;
        // Something else was opened (or saved) meanwhile.
        if (this.saved$.value !== saved || model === undefined) return;
        if (saved.model === null || this.pending) {
          this.saved$.next({
            project: remote,
            model: saved.model ?? snapshot(model),
          });
          this.persist();
        } else {
          this.replace(model, remote);
        }
        // The list may have moved on while this was read.
        this.followCloud();
      })
      .catch((error) => {
        this.following = null;
        reportError('reading the project from Firebase', error);
      });
  }

  /** Puts `model` in place of the work, as the given saved project or none. */
  private replace(model: ModelType, project: Project | null) {
    this.saved$.next(project && { project, model: snapshot(model) });
    this.model$.next(model);
    this.persist();
    this.replaced$.next();
  }

  /** Keeps the work (and the project it belongs to) for the next visit. */
  private persist(model = this.value) {
    saveModel(model, this.project);
  }

  /** On start, links the work again to the saved project it belonged to. */
  private async restoreProject(ref: Project | null) {
    if (!ref) return;
    const { id } = ref;
    const placeholder: SavedProject = { project: ref, model: null };
    this.saved$.next(placeholder);
    if (ref.cloud) {
      // `followCloud()` links it, once Firebase says what's there.
      this.cloud.start();
      await firstValueFrom(
        race(
          this.saved$.pipe(filter((saved) => saved !== placeholder)),
          timer(CLOUD_WAIT),
        ),
      );
      return;
    }
    const [project, stored] = await Promise.all([
      getProject(id).catch(() => null),
      loadProject(id).catch(() => undefined),
    ]);
    // Something else was opened meanwhile.
    if (this.saved$.value !== placeholder) return;
    this.saved$.next(
      project && stored !== undefined
        ? { project, model: snapshot(stored) }
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
 * with defaults in place of what's unset (the editor clears hidden fields).
 */
export function work(model: ModelType): ModelType {
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
export function snapshot<T>(value: T): T {
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
