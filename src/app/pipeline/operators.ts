import {
  distinctUntilChanged,
  MonoTypeOperatorFunction,
  ReplaySubject,
  share,
  timer,
} from 'rxjs';

/**
 * Shares one subscription and replays its latest value to late
 * subscribers. Resets a tick after the last unsubscribe, so a pipeline that
 * is only briefly unsubscribed (e.g. while its list is rebuilt) keeps going.
 */
export function shareLatest<T>(): MonoTypeOperatorFunction<T> {
  return share<T>({
    connector: () => new ReplaySubject(1),
    resetOnRefCountZero: () => timer(0),
  });
}

/** Skips values that serialize to the same JSON as the previous one. */
export function distinctJson<T>(): MonoTypeOperatorFunction<T> {
  return distinctUntilChanged<T, string>(
    (a, b) => a === b,
    (value) => JSON.stringify(value),
  );
}

/** Skips arrays holding the same items (by identity) as the previous one. */
export function distinctItems<T>(): MonoTypeOperatorFunction<T[]> {
  return distinctUntilChanged(
    (a, b) => a.length === b.length && a.every((item, i) => b[i] === item),
  );
}
