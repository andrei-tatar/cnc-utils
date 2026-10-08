import { ErrorHandler, Injectable } from '@angular/core';
import { reportError } from '../pipeline/errors';

/**
 * Errors nothing else caught (Angular's, and with the browser's global
 * listeners, uncaught errors and rejections): logged, and shown to the user
 * (see ErrorToastComponent) rather than only in the console.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    reportError('unexpectedly', error);
  }
}
