import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
} from 'rxjs';

/** Tracks whether any worker computation is running, for the spinner. */
@Injectable({ providedIn: 'root' })
export class WorkTracker {
  private locks = new BehaviorSubject(0);

  /**
   * Never emits; counts as work in progress while subscribed. `race` it
   * against a worker call so the work counts until the call emits.
   */
  readonly working$ = new Observable<never>(() => {
    this.locks.next(this.locks.value + 1);
    return () => this.locks.next(this.locks.value - 1);
  });

  readonly isWorking$ = this.locks.pipe(
    map((locks) => locks > 0),
    distinctUntilChanged(),
    debounceTime(100),
  );
}
