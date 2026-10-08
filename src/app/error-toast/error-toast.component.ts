import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppError, appErrors$ } from '../pipeline/errors';

type Toast = AppError & { id: number; count: number; timer?: number };

/** How long a toast stays up (ms), from its last repeat. */
const SHOW_FOR = 10_000;
/** At most this many at once; older ones give way. */
const MAX_TOASTS = 3;

/**
 * "Something went wrong" toasts for errors reported anywhere (see
 * reportError): what was being done and what went wrong, a repeat of the
 * same one counted on it rather than stacked.
 */
@Component({
  selector: 'app-error-toast',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="toast-container" aria-live="assertive" aria-atomic="true">
      @for (toast of toasts(); track toast.id) {
        <div class="toast show" role="alert">
          <div class="toast-header">
            <span class="dot" aria-hidden="true"></span>
            <strong class="me-auto">Something went wrong</strong>
            @if (toast.count > 1) {
              <span class="badge text-bg-secondary me-2"
                >×{{ toast.count }}</span
              >
            }
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              (click)="dismiss(toast.id)"
            ></button>
          </div>
          <div class="toast-body">
            <div>Error {{ toast.context }}: {{ toast.message }}</div>
            <div class="hint">
              What it was working on is left out until the next change. Details
              are in the browser console.
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-container {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: min(380px, calc(100vw - 32px));
    }
    .toast {
      width: auto;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--bs-danger);
      margin-right: 8px;
      flex: none;
    }
    .toast-body {
      overflow-wrap: anywhere;
    }
    .hint {
      margin-top: 4px;
      font-size: 0.8125rem;
      color: var(--bs-secondary-color);
    }
  `,
})
export class ErrorToastComponent {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  constructor() {
    appErrors$
      .pipe(takeUntilDestroyed())
      .subscribe((error) => this.show(error));
    inject(DestroyRef).onDestroy(() =>
      this.toasts().forEach((t) => clearTimeout(t.timer)),
    );
  }

  dismiss(id: number) {
    const toast = this.toasts().find((t) => t.id === id);
    clearTimeout(toast?.timer);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private show(error: AppError) {
    const list = this.toasts();
    const same = list.find(
      (t) => t.context === error.context && t.message === error.message,
    );
    if (same) {
      clearTimeout(same.timer);
      const updated = { ...same, count: same.count + 1 };
      updated.timer = this.expire(updated.id);
      this.toasts.set(list.map((t) => (t === same ? updated : t)));
      return;
    }
    const id = this.nextId++;
    const toast: Toast = { ...error, id, count: 1, timer: this.expire(id) };
    const kept = list.slice(-(MAX_TOASTS - 1));
    list
      .slice(0, list.length - kept.length)
      .forEach((t) => clearTimeout(t.timer));
    this.toasts.set([...kept, toast]);
  }

  private expire(id: number) {
    return window.setTimeout(() => this.dismiss(id), SHOW_FOR);
  }
}
