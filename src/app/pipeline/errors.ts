import { catchError, Observable, of, OperatorFunction, Subject } from 'rxjs';

/** Something that went wrong, for the UI to tell the user about. */
export type AppError = {
  /** What was being done, in a few words ("routing a pocket"). */
  context: string;
  /** What went wrong, from the error. */
  message: string;
};

const errors = new Subject<AppError>();

/** Every error reported (see reportError), as it happens. */
export const appErrors$: Observable<AppError> = errors.asObservable();

/** Logs `error` and tells the UI about it. */
export function reportError(context: string, error: unknown): void {
  console.error(`Error ${context}:`, error);
  errors.next({ context, message: errorMessage(error) });
}

/**
 * On an error: report it and carry on with `fallback()` in place of the
 * result, so the pipeline it's in lives on (and the next change tries
 * again) instead of erroring out for good.
 */
export function recover<T>(
  context: string,
  fallback: () => T,
): OperatorFunction<T, T> {
  return catchError((error) => {
    reportError(context, error);
    return of(fallback());
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // What a WebAssembly trap says: a panic in the geometry kernel.
    if (error.message === 'unreachable') {
      return 'the geometry kernel crashed (unreachable)';
    }
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
