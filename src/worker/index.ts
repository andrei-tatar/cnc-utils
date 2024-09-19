import {
  debounceTime,
  defer,
  dematerialize,
  EMPTY,
  filter,
  finalize,
  ignoreElements,
  map,
  materialize,
  merge,
  mergeMap,
  Observable,
  ReplaySubject,
  share,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { Contract, MessageFromWorker, MessageToWorker } from './types';

type Job = {
  type: string;
  args: any[];
  result$: Subject<any>;
  stop$: Observable<any>;
};

const MAX_WORKERS = 6;
const KEEP_IDLE_FOR = 5 * 60 * 1000; //5 mins

type RptContract = {
  [K in keyof Contract]: (
    ...args: Parameters<Contract[K]>
  ) => Observable<ReturnType<Contract[K]>>;
};

const worker: RptContract = new Proxy({} as RptContract, {
  get(_target, name: string) {
    return startJob.bind(null, name);
  },
});

export default worker;

function startJob(type: string, ...args: any[]): Observable<any> {
  const result$ = new Subject<any>();
  const stop$ = new ReplaySubject<any>(1);
  return merge(
    result$,
    execute$,
    defer(() => {
      jobs$.next({
        type,
        args,
        result$,
        stop$,
      });
      return EMPTY;
    }),
  ).pipe(
    take(1),
    finalize(() => stop$.next(true)),
  );
}

const jobs$ = new Subject<Job>();
const availableWorkers: Observable<WorkerInstance>[] = [];

const execute$ = jobs$.pipe(
  mergeMap((work) => {
    let worker$ = availableWorkers.pop();
    if (!worker$) {
      worker$ = new Observable<WorkerInstance>((observer) => {
        const worker = new Worker(new URL('./main.worker', import.meta.url));
        const workerInstance = new WorkerInstance(worker);
        console.log(`[worker] new worker ${workerInstance.id}`);

        observer.next(workerInstance);

        const sub = workerInstance.terminate$.subscribe(() => {
          observer.complete();
        });

        sub.add(() => {
          const foundIndex = availableWorkers.indexOf(worker$!);
          if (foundIndex >= 0) {
            availableWorkers.splice(foundIndex, 1);
          }

          worker.terminate();
          console.log(`[worker] terminating ${workerInstance.id}`);
        });

        return sub;
      }).pipe(
        share({
          connector: () => new ReplaySubject(1),
          resetOnRefCountZero: () => timer(KEEP_IDLE_FOR),
        }),
      );
    } else {
      console.log('[worker] using idle worker');
    }

    const done$ = new Subject<any>();
    return worker$.pipe(
      switchMap((worker) =>
        worker
          .execute(work.type, work.args, () => {
            console.log(`[worker] idle ${worker.id}`);
            availableWorkers.push(worker$);
          })
          .pipe(
            tap(work.result$),
            finalize(() => done$.next(1)),
            takeUntil(work.stop$),
          ),
      ),
      ignoreElements(),
      takeUntil(done$),
    );
  }, MAX_WORKERS),
  share({
    resetOnRefCountZero: false,
  }),
);

class WorkerInstance {
  private msg$: Observable<MessageFromWorker>;
  private terminate = new Subject<any>();

  readonly terminate$ = this.terminate.asObservable();
  readonly id = crypto.randomUUID();

  constructor(private worker: Worker) {
    this.msg$ = new Observable<MessageFromWorker>((observer) => {
      const handler = (ev: MessageEvent<any>) => {
        observer.next(ev.data);
      };
      worker.addEventListener('message', handler);
      worker.addEventListener('error', (err) => observer.error(err.error));
      worker.addEventListener('messageerror', (err) =>
        observer.error(err.data),
      );
      return () => worker.removeEventListener('message', handler);
    }).pipe(share());
  }

  execute(type: string, args: any[], addToIdle: () => void): Observable<any> {
    return defer(() => {
      let hasResult = false;
      const result$ = this.msg$.pipe(
        filter((v) => v.type === 'result'),
        take(1),
        tap((_) => {
          hasResult = true;
          addToIdle();
        }),
        map((v) => v.result),
        dematerialize(),
        finalize(() => {
          if (!hasResult) {
            this.terminate.next(1);
          }
        }),
      );

      const tx$ = this.send({
        type: 'work',
        work: type,
        args: args,
      });

      return merge(result$, tx$);
    });
  }

  private send(msg: MessageToWorker): Observable<never> {
    return new Observable((observer) => {
      this.worker.postMessage(msg);
      observer.complete();
    });
  }
}
