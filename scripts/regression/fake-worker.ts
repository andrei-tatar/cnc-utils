// Stands in for src/worker/index.ts in the regression harness: runs each
// work function in this process, its arguments and result going through
// the same codec as the real worker pool (so packing is exercised too).
import * as fs from 'node:fs';
import { defer, lastValueFrom, Observable, take, toArray } from 'rxjs';
import { pack, unpack } from '../../src/worker/codec';
import * as work from '../../src/worker/work';

/** Work calls running now: the harness waits for none. */
export const running = { count: 0 };

type Contract = {
  [K in keyof typeof work]: (
    ...args: Parameters<(typeof work)[K]>
  ) => Observable<Awaited<ReturnType<(typeof work)[K]>>>;
};

/** Profiling: the calls in turn. */
let queue: Promise<unknown> = Promise.resolve();

const worker: Contract = new Proxy({} as Contract, {
  get(_target, name: string) {
    return (...args: unknown[]) =>
      new Observable((subscriber) => {
        const found = (work as Record<string, Function>)[name];
        if (!found) {
          subscriber.error(new Error(`no work function ${name}`));
          return;
        }
        running.count++;
        // REGRESSION_PROFILE=<file>: calls run one at a time, each one's name
        // and time (ms) logged, so a call's time is its own.
        const log = process.env['REGRESSION_PROFILE'];
        let started = 0;
        let done = false;
        const finish = (completed: boolean) => {
          if (!done) {
            done = true;
            running.count--;
            if (log && completed) {
              fs.appendFileSync(
                log,
                `${name}\t${(performance.now() - started).toFixed(2)}\n`,
              );
            }
          }
        };
        const call = () => {
          started = performance.now();
          return lastValueFrom(
            defer(() =>
              found.apply(null, unpack(pack(args)) as unknown[]),
            ).pipe(take(1), toArray()),
          );
        };
        const result = log ? (queue = queue.then(call, call)) : call();
        result.then(
          (values) => {
            finish(true);
            if (values.length) {
              subscriber.next(unpack(pack(values[0])));
            }
            subscriber.complete();
          },
          (error) => {
            finish(true);
            subscriber.error(error);
          },
        );
        // Cancelling drops the result, like the pool does.
        return () => finish(false);
      });
  },
});

export default worker;
