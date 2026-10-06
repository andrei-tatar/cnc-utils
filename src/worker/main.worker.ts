/// <reference lib="webworker" />

import { defer, lastValueFrom, take, toArray } from 'rxjs';
import { JobOutcome, MessageFromWorker, MessageToWorker } from './types';
import { pack, transferables, unpack } from './codec';
import {
  cachedResult,
  hashValue,
  MIN_CACHED_MS,
  openCache,
  storeResult,
} from './result-cache';
import * as work from './work';

// One job at a time: the main thread only sends the next one after this
// one's result.
addEventListener('message', async ({ data }: MessageEvent<MessageToWorker>) => {
  if (data?.type !== 'work') {
    return;
  }
  const { id, work: name, args, cache } = data;

  try {
    const found = (work as Record<string, Function>)[name];
    if (!found) {
      throw new Error(`no contract registration found for ${name}`);
    }

    // The worker's own URL changes with its code, so results from another
    // build are never reused.
    const key = cache ? hashValue([name, args], self.location.href) : null;
    const database = key ? await openCache() : null;
    if (key && database) {
      const hit = await cachedResult(database, key);
      if (hit !== undefined) {
        reply(id, { kind: 'N', value: hit });
        return;
      }
    }

    const started = performance.now();
    const values = await lastValueFrom(
      defer(() => found.apply(null, unpack(args) as unknown[])).pipe(
        take(1),
        toArray(),
      ),
    );
    if (!values.length) {
      reply(id, { kind: 'C' });
      return;
    }
    const value = pack(values[0]);
    if (key && database && performance.now() - started >= MIN_CACHED_MS) {
      // Stored (copied) before the reply transfers the buffers away.
      storeResult(database, key, value);
    }
    reply(id, { kind: 'N', value });
  } catch (error) {
    reply(id, { kind: 'E', error });
  }
});

function reply(id: number, outcome: JobOutcome) {
  const message: MessageFromWorker = { type: 'result', id, outcome };
  try {
    postMessage(message, transferables(outcome));
  } catch (cloneError) {
    // An error that can't be cloned: send what it says instead.
    postMessage({
      type: 'result',
      id,
      outcome: {
        kind: 'E',
        error: new Error(
          String(outcome.kind === 'E' ? outcome.error : cloneError),
        ),
      },
    } satisfies MessageFromWorker);
  }
}
