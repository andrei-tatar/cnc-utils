import {
  Component,
  inject,
  Input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** A small "are you sure?" modal; resolves `true` when confirmed. */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  styles: `
    .modal-header {
      border-bottom: none;
      padding-bottom: 0;
    }

    .modal-title {
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: var(--bs-danger);
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .icon--question {
      stroke: var(--bs-primary);
    }

    .modal-body {
      font-size: 0.875rem;
    }

    .details {
      margin: 8px 0 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--bs-warning-bg-subtle);
      color: var(--bs-warning-text-emphasis);
      list-style: none;

      li + li {
        margin-top: 2px;
      }
    }

    .modal-footer {
      border-top: none;
      padding-top: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="modal-header">
      <h2 class="modal-title" id="confirm-title">
        <svg
          class="icon"
          [class.icon--question]="kind === 'question'"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          @if (kind === 'question') {
            <path
              d="M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.3v.2"
            />
          } @else {
            <path
              d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4"
            />
          }
        </svg>
        {{ title }}
      </h2>
    </div>
    <div class="modal-body">
      <p class="mb-0">{{ message }}</p>
      @if (details.length) {
        <ul class="details">
          @for (detail of details; track detail) {
            <li>⚠ {{ detail }}</li>
          }
        </ul>
      }
    </div>
    <div class="modal-footer">
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        (click)="modal.dismiss()"
      >
        {{ cancelLabel }}
      </button>
      <button
        type="button"
        class="btn btn-sm"
        [class.btn-danger]="kind === 'danger'"
        [class.btn-primary]="kind === 'question'"
        ngbAutofocus
        (click)="modal.close(true)"
      >
        {{ confirmLabel }}
      </button>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly modal = inject(NgbActiveModal);

  @Input() title = 'Are you sure?';
  @Input() message = '';
  @Input() details: string[] = [];
  @Input() confirmLabel = 'Delete';
  @Input() cancelLabel = 'Cancel';
  /** `danger`: deleting (red); `question`: a choice between two ways. */
  @Input() kind: 'danger' | 'question' = 'danger';
}
