import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  fromEvent,
  Observable,
  shareReplay,
  Subject,
  switchMap,
} from 'rxjs';
import { deepEqual } from '../../util';
import { migrateModel, ModelType } from '../model-editor/model';
import { readModelFromNcFile } from '../project-file';

const MODEL_STORAGE_KEY = 'model';
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
   */
  readonly changes$: Observable<ModelType> = this.model$.pipe(
    distinctUntilChanged((a, b) => deepEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private open$ = new Subject<void>();

  constructor() {
    this.changes$.pipe(debounceTime(SAVE_DELAY)).subscribe(saveModel);
    // Don't lose an edit still waiting to be saved.
    fromEvent(window, 'pagehide').subscribe(() => saveModel(this.value));

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
}

function loadModel(): ModelType {
  const model = localStorage.getItem(MODEL_STORAGE_KEY);
  return migrateModel(model ? JSON.parse(model) : {});
}

function saveModel(model: ModelType) {
  localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));
}
