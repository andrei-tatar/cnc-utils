import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ModelFieldConfig, ModelType } from '../model-editor/model';
import { sameWork } from '../model-editor/same-work';
import { ModelStore, snapshot, work } from './model-store.service';

/** Edits closer together than this are undone as one (typing a number). */
const GROUP_MS = 1000;
/** How many steps back are kept. */
const LIMIT = 200;

/**
 * Undo and redo over the work's states. Each change of the model is a step,
 * except what only the editor changes (expanding an item, filling in a
 * default: `sameWork`) and edits in quick succession, which join the step
 * before. Opening, loading or starting a project starts the history afresh.
 */
@Injectable({ providedIn: 'root' })
export class ModelHistory {
  private readonly store = inject(ModelStore);

  private past: ModelType[] = [];
  private future: ModelType[] = [];
  /** The work as it is now (a snapshot: the editor changes the model in place). */
  private current: ModelType = snapshot(this.store.value);
  private lastEdit = 0;

  readonly state$ = new BehaviorSubject({ canUndo: false, canRedo: false });

  constructor() {
    this.store.changes$.subscribe((model) => this.changed(model));
    this.store.replaced$.subscribe(() => this.reset());
  }

  undo() {
    this.step(this.past, this.future);
  }

  redo() {
    this.step(this.future, this.past);
  }

  private step(from: ModelType[], to: ModelType[]) {
    const model = from.pop();
    if (!model) return;
    to.push(this.current);
    this.current = model;
    // Whatever is typed next is a step of its own.
    this.lastEdit = 0;
    this.store.restore(model);
    this.publish();
  }

  private changed(model: ModelType) {
    if (
      sameWork(
        work(model),
        work(withoutMissing(this.current, model)),
        ModelFieldConfig,
      )
    ) {
      // The editor settling (defaults filled in, hidden fields dropped, an
      // item expanded), or the echo of a state just restored: not a step.
      this.current = snapshot(model);
      return;
    }
    const now = Date.now();
    if (now - this.lastEdit > GROUP_MS || !this.past.length) {
      this.past.push(this.current);
      if (this.past.length > LIMIT) this.past.shift();
    }
    this.lastEdit = now;
    this.current = snapshot(model);
    this.future = [];
    this.publish();
  }

  private reset() {
    this.past = [];
    this.future = [];
    this.current = snapshot(this.store.value);
    this.lastEdit = 0;
    this.publish();
  }

  private publish() {
    this.state$.next({
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    });
  }
}

/**
 * `before` without the properties `after` doesn't have: the editor drops
 * hidden fields (a borrowing operation's shape, another bit's settings),
 * which isn't an edit. Edits change values, or add or remove list items.
 */
function withoutMissing(before: unknown, after: unknown): any {
  if (Array.isArray(before)) {
    return Array.isArray(after) && after.length === before.length
      ? before.map((item, i) => withoutMissing(item, after[i]))
      : before;
  }
  if (
    typeof before !== 'object' ||
    before === null ||
    typeof after !== 'object' ||
    after === null ||
    Array.isArray(after)
  ) {
    return before;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(before)) {
    const other = (after as Record<string, unknown>)[key];
    if (other !== undefined) {
      kept[key] = withoutMissing(value, other);
    }
  }
  return kept;
}
