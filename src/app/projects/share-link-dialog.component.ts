import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { LONG_LINK, TOO_LONG_LINK } from '../share-link';

/** Shows a link that opens the project, to copy and send. */
@Component({
  selector: 'app-share-link-dialog',
  styles: `
    .modal-header {
      border-bottom: none;
      padding-bottom: 0;
    }

    .modal-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .modal-body {
      font-size: 0.875rem;
    }

    .link {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .link input {
      font-family: var(--code-font, monospace);
      font-size: 0.75rem;
    }

    .size {
      margin: 6px 0 0;
      color: var(--bs-secondary-color);
      font-size: 0.75rem;
    }

    .warning {
      margin: 8px 0 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--bs-warning-bg-subtle);
      color: var(--bs-warning-text-emphasis);
    }

    .modal-footer {
      border-top: none;
      padding-top: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="modal-header">
      <h2 class="modal-title" id="share-link-title">Share link</h2>
    </div>
    <div class="modal-body">
      @if (tooLong()) {
        <p class="warning" role="status">
          ⚠ This project is too big for a link ({{ size() }}), most likely
          because of an imported picture or file. Send its G-code file instead:
          it holds the project too.
        </p>
      } @else {
        <p class="mb-0">
          Opening this link gives a copy of the project. Nothing is uploaded:
          the project is in the link itself.
        </p>
        <div class="link">
          <input
            #input
            class="form-control form-control-sm"
            type="text"
            readonly
            aria-label="Link to the project"
            [value]="link"
            (focus)="input.select()"
          />
          <button
            type="button"
            class="btn btn-sm btn-primary"
            ngbAutofocus
            (click)="copy(input)"
          >
            {{ copied() ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="size">{{ size() }}</p>
        @if (long()) {
          <p class="warning" role="status">
            ⚠ A long link: chat apps and email may cut it short. If it doesn’t
            open, send the G-code file instead (it holds the project too).
          </p>
        }
      }
    </div>
    <div class="modal-footer">
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        (click)="modal.close()"
      >
        Close
      </button>
    </div>
  `,
})
export class ShareLinkDialogComponent {
  readonly modal = inject(NgbActiveModal);

  @Input() set link(value: string) {
    this.value.set(value);
  }
  get link() {
    return this.value();
  }
  private readonly value = signal('');

  readonly copied = signal(false);
  readonly long = computed(() => this.value().length > LONG_LINK);
  readonly tooLong = computed(() => this.value().length > TOO_LONG_LINK);
  readonly size = computed(() => {
    const length = this.value().length;
    return length < 1000
      ? `${length} characters`
      : `${Math.round(length / 100) / 10}k characters`;
  });

  async copy(input: HTMLInputElement) {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
    } catch {
      // Not allowed: leave it selected to copy by hand.
      input.focus();
      input.select();
    }
  }
}
