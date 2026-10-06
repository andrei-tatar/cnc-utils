import type { ObservedValueOf } from 'rxjs';
import type * as AllWork from './work';

/** How a job ended: with a value, with nothing, or with an error. */
export type JobOutcome =
  { kind: 'N'; value: unknown } | { kind: 'C' } | { kind: 'E'; error: unknown };

export type MessageFromWorker = {
  type: 'result';
  /** The job this answers. */
  id: number;
  outcome: JobOutcome;
};

export type MessageToWorker = {
  type: 'work';
  id: number;
  work: string;
  /** Packed (see `codec.ts`). */
  args: unknown[];
  /** Look the result up in (and add it to) the persistent result cache. */
  cache: boolean;
};

export type Contract = {
  [K in keyof typeof AllWork]: (
    ...args: Parameters<(typeof AllWork)[K]>
  ) => ObservedValueOf<ReturnType<(typeof AllWork)[K]>>;
};
