import { isDevMode } from '@angular/core';
import { Observable } from 'rxjs';
import { pack, unpack } from './codec';
import {
  Contract,
  JobOutcome,
  MessageFromWorker,
  MessageToWorker,
} from './types';

/** Jobs running at once: leave a core for the page itself. */
const MAX_WORKERS = Math.max(
  2,
  Math.min(12, (navigator.hardwareConcurrency || 4) - 1),
);
/** Idle workers are kept this long, then terminated. */
const KEEP_IDLE_FOR = 5 * 60 * 1000;
/**
 * A cancelled job may finish within this long, and its worker (with clipper
 * and any fonts already loaded) goes back to the pool; after that it's
 * terminated. Most jobs are short, and starting a worker isn't.
 */
const CANCEL_GRACE = 1500;
/** Workers, including ones finishing cancelled jobs, never exceed this. */
const MAX_TOTAL_WORKERS = MAX_WORKERS * 2;

type RptContract = {
  [K in keyof Contract]: (
    ...args: Parameters<Contract[K]>
  ) => Observable<ReturnType<Contract[K]>>;
};

/**
 * The work functions of `./work`, run in a pool of web workers. Each call
 * runs when subscribed; unsubscribing cancels it.
 */
const worker: RptContract = new Proxy({} as RptContract, {
  get(_target, name: string) {
    return (...args: unknown[]) => startJob(name, args);
  },
});

export default worker;

type Job = {
  id: number;
  work: string;
  args: unknown[];
  settle(outcome: JobOutcome): void;
};

class PooledWorker {
  readonly worker = new Worker(new URL('./main.worker', import.meta.url));
  /** The job it's running (null while idle). */
  job: Job | null = null;
  /** The job was cancelled: its result is dropped when it comes. */
  cancelled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private onFree: (w: PooledWorker) => void) {
    this.worker.addEventListener(
      'message',
      ({ data }: MessageEvent<MessageFromWorker>) => {
        if (data?.type !== 'result' || data.id !== this.job?.id) {
          return;
        }
        const job = this.job;
        const cancelled = this.cancelled;
        this.release();
        // Back in the pool first, so jobs started by the result can use it.
        this.onFree(this);
        if (!cancelled) {
          job.settle(data.outcome);
        }
      },
    );
    const fail = (error: unknown) => {
      const job = this.job;
      const cancelled = this.cancelled;
      this.terminate();
      if (job && !cancelled) {
        job.settle({ kind: 'E', error });
      }
    };
    this.worker.addEventListener('error', (event) => {
      event.preventDefault();
      fail(event.error ?? new Error(event.message));
    });
    this.worker.addEventListener('messageerror', () =>
      fail(new Error('could not read the worker’s result')),
    );
  }

  run(job: Job) {
    clearTimeout(this.timer);
    this.job = job;
    this.cancelled = false;
    this.worker.postMessage({
      type: 'work',
      id: job.id,
      work: job.work,
      args: job.args,
      cache: !isDevMode(),
    } satisfies MessageToWorker);
  }

  /** Stop waiting for the job; terminate if it doesn't finish soon. */
  cancel() {
    this.cancelled = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.terminate(), CANCEL_GRACE);
  }

  /** Idle: terminate after a while unless given another job. */
  idle() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.terminate(), KEEP_IDLE_FOR);
  }

  terminate() {
    clearTimeout(this.timer);
    this.worker.terminate();
    this.job = null;
    pool.delete(this);
    const at = idle.indexOf(this);
    if (at >= 0) idle.splice(at, 1);
    pump();
  }

  private release() {
    clearTimeout(this.timer);
    this.job = null;
    this.cancelled = false;
  }
}

const pool = new Set<PooledWorker>();
const idle: PooledWorker[] = [];
const queue: Job[] = [];
let nextId = 1;

function startJob(work: string, args: unknown[]): Observable<any> {
  return new Observable((subscriber) => {
    let settled = false;
    const job: Job = {
      id: nextId++,
      work,
      args: pack(args) as unknown[],
      settle(outcome) {
        settled = true;
        switch (outcome.kind) {
          case 'N':
            subscriber.next(unpack(outcome.value));
            subscriber.complete();
            break;
          case 'C':
            subscriber.complete();
            break;
          case 'E':
            subscriber.error(outcome.error);
        }
      },
    };
    queue.push(job);
    pump();

    return () => {
      if (settled) return;
      const queued = queue.indexOf(job);
      if (queued >= 0) {
        queue.splice(queued, 1);
        return;
      }
      for (const w of pool) {
        if (w.job === job) {
          w.cancel();
          pump();
        }
      }
    };
  });
}

/** Start queued jobs while there's room. */
function pump() {
  while (queue.length) {
    const active = [...pool].filter((w) => w.job && !w.cancelled).length;
    if (active >= MAX_WORKERS) return;

    let w = idle.pop();
    if (!w) {
      if (pool.size >= MAX_TOTAL_WORKERS) return;
      w = new PooledWorker(onFree);
      pool.add(w);
    }
    w.run(queue.shift()!);
  }
}

function onFree(w: PooledWorker) {
  idle.push(w);
  w.idle();
  pump();
}
