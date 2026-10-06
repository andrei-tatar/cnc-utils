import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  Observable,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { migrateModel, ModelType } from '../model-editor/model';
import { readModelFromNcFile } from '../project-file';

const MODEL_STORAGE_KEY = 'model';

/** The project being edited: the single source of truth for the app. */
@Injectable({ providedIn: 'root' })
export class ModelStore {
  readonly model$ = new BehaviorSubject<ModelType>(loadModel());

  /** The model as it changes, saved to localStorage as it goes. */
  readonly changes$: Observable<ModelType> = this.model$.pipe(
    distinctUntilChanged(),
    tap(saveModel),
  );

  private open$ = new Subject<void>();

  constructor() {
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
