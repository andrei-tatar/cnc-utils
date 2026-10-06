import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  filter,
  fromEvent,
  merge,
  Observable,
  shareReplay,
  Subject,
  switchMap,
} from 'rxjs';
import { migrateModel, ModelType } from '../model-editor/model';
import { readModelFromNcFile } from '../project-file';
import { loadTemplate, Template } from '../templates';
import { deepEqual } from '../../util';
import { loadModel, saveModel } from './model-persistence';
/** Saving waits for a pause in editing (and happens when leaving). */
const SAVE_DELAY = 500;

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

  private open$ = new Subject<void>();

  constructor() {
    this.changes$.pipe(debounceTime(SAVE_DELAY)).subscribe(saveModel);
    // Don't lose an edit still waiting to be saved: when the page is hidden
    // (it may be frozen or discarded without closing) or leaves.
    merge(
      fromEvent(window, 'pagehide'),
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'hidden'),
      ),
    ).subscribe(() => saveModel(this.value));

    // A new request cancels one still waiting for its file.
    this.open$
      .pipe(switchMap(() => readModelFromNcFile()))
      .subscribe((model) => this.model$.next(model));
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

  /** Replaces the project with a template one. */
  async openTemplate(template: Template) {
    this.model$.next(migrateModel(await loadTemplate(template)));
  }
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
