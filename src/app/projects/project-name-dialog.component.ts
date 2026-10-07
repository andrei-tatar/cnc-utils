import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** Asks for a project's name; resolves with it (trimmed) when saved. */
@Component({
  selector: 'app-project-name-dialog',
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

    .replaces {
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
    <form (submit)="$event.preventDefault(); save()">
      <div class="modal-header">
        <h2 class="modal-title" id="project-name-title">{{ title }}</h2>
      </div>
      <div class="modal-body">
        <label class="form-label" for="project-name">Name</label>
        <input
          id="project-name"
          class="form-control form-control-sm"
          type="text"
          autocomplete="off"
          ngbAutofocus
          [value]="name()"
          (input)="name.set($any($event.target).value)"
        />
        @if (replaces()) {
          <p class="replaces" role="status">
            ⚠ Replaces the saved project of that name.
          </p>
        }
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          (click)="modal.dismiss()"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-sm btn-primary"
          [disabled]="!trimmed()"
        >
          {{ replaces() ? 'Replace' : 'Save' }}
        </button>
      </div>
    </form>
  `,
})
export class ProjectNameDialogComponent {
  readonly modal = inject(NgbActiveModal);

  @Input() title = 'Save project';
  @Input() set initialName(name: string) {
    this.name.set(name);
  }
  /** The names of the saved projects saving would replace. */
  @Input() takenNames: string[] = [];

  readonly name = signal('');
  readonly trimmed = computed(() => this.name().trim());
  readonly replaces = computed(() => this.takenNames.includes(this.trimmed()));

  save() {
    if (this.trimmed()) {
      this.modal.close(this.trimmed());
    }
  }
}
