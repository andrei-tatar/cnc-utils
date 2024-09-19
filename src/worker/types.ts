import type { ObservableNotification, ObservedValueOf } from 'rxjs';
import type * as AllWork from './work';

export type MessageFromWorker = {
  type: 'result';
  result: ObservableNotification<any>;
};

export type MessageToWorker = {
  type: 'work';
  work: string;
  args: any[];
};

export type Contract = {
  [K in keyof typeof AllWork]: (
    ...args: Parameters<(typeof AllWork)[K]>
  ) => ObservedValueOf<ReturnType<(typeof AllWork)[K]>>;
};
