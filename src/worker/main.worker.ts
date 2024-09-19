/// <reference lib="webworker" />

import {
  defer,
  filter,
  map,
  materialize,
  Observable,
  switchMap,
  take,
} from 'rxjs';
import { Contract, MessageToWorker } from './types';
import * as work from './work';

new Observable<MessageToWorker>((observer) => {
  const handler = ({ data }: MessageEvent) => {
    observer.next(data);
  };
  addEventListener('message', handler);
  return () => removeEventListener('message', handler);
})
  .pipe(
    filter((m) => m.type === 'work'),
    switchMap((w) => {
      const key: keyof Contract = w.work as any;
      const found: Function = work[key];
      if (!found) {
        throw new Error(`no contract registration found for ${w.work}`);
      }

      return defer(() => found.apply(null, w.args)).pipe(take(1));
    }),
    materialize(),
    map(
      (result) =>
        ({
          type: 'result',
          result,
        }) as const,
    ),
  )
  .subscribe((msg) => postMessage(msg));
