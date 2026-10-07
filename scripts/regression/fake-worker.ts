// Stands in for src/worker/index.ts in the regression harness: runs each
// work function in this process, its arguments and result going through
// the same codec as the real worker pool (so packing is exercised too).
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
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            running.count--;
          }
        };
        lastValueFrom(
          defer(() => found.apply(null, unpack(pack(args)) as unknown[])).pipe(
            take(1),
            toArray(),
          ),
        ).then(
          (values) => {
            finish();
            if (values.length) {
              subscriber.next(unpack(pack(values[0])));
            }
            subscriber.complete();
          },
          (error) => {
            finish();
            subscriber.error(error);
          },
        );
        // Cancelling drops the result, like the pool does.
        return finish;
      });
  },
});

export default worker;
