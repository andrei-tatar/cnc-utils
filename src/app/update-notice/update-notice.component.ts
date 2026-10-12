import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * The app works offline: a service worker keeps it (see ngsw-config.json).
 * When a newer version has been fetched in the background, this offers to
 * switch to it; when the kept copy can't be used any more, it reloads.
 */
@Component({
  selector: 'app-update-notice',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (ready()) {
      <div class="toast show notice" role="status">
        <div class="toast-body">
          <span>A new version of CNC Utils is ready.</span>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="reload()"
          >
            Reload
          </button>
          <button
            type="button"
            class="btn-close"
            aria-label="Later"
            (click)="ready.set(false)"
          ></button>
        </div>
      </div>
    }
  `,
  styles: `
    .notice {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 1080;
      width: auto;
    }

    .toast-body {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.875rem;
    }
  `,
})
export class UpdateNoticeComponent {
  private readonly updates = inject(SwUpdate);
  readonly ready = signal(false);

  constructor() {
    if (!this.updates.isEnabled) {
      return;
    }
    this.updates.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.ready.set(true));
    // The kept copy is broken (its files are gone from the server): only a
    // reload from the network helps.
    this.updates.unrecoverable
      .pipe(takeUntilDestroyed())
      .subscribe(() => location.reload());
  }

  /** Switches to the new version (the work is kept: it's saved as it goes). */
  reload() {
    location.reload();
  }
}
