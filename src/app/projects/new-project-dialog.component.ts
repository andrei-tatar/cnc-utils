import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** What a new project keeps from the current one. */
export interface KeptInNewProject {
  tools: boolean;
  gcode: boolean;
}

/**
 * Asks before starting a new project, and what to keep from the current
 * one (both kept unless unticked); resolves with that when started.
 */
@Component({
  selector: 'app-new-project-dialog',
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

    .keep {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .keep .form-check-input {
      margin: 0;
    }

    .lost {
      margin: 10px 0 0;
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
      <h2 class="modal-title" id="new-project-title">Start a new project?</h2>
    </div>
    <div class="modal-body">
      <p class="mb-0">
        The current project is closed (the tool library is kept).
      </p>
      <label class="keep">
        <input
          type="checkbox"
          class="form-check-input"
          [checked]="tools()"
          (change)="tools.set(!tools())"
        />
        <span>Keep the tools</span>
      </label>
      <label class="keep">
        <input
          type="checkbox"
          class="form-check-input"
          [checked]="gcode()"
          (change)="gcode.set(!gcode())"
        />
        <span>Keep the G-code options</span>
      </label>
      @if (lost) {
        <p class="lost" role="status">⚠ {{ lost }}</p>
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
        type="button"
        class="btn btn-sm btn-primary"
        ngbAutofocus
        (click)="start()"
      >
        New project
      </button>
    </div>
  `,
})
export class NewProjectDialogComponent {
  readonly modal = inject(NgbActiveModal);

  /** What's lost with the current project, when it has unsaved work. */
  @Input() lost = '';

  readonly tools = signal(true);
  readonly gcode = signal(true);

  start() {
    const kept: KeptInNewProject = { tools: this.tools(), gcode: this.gcode() };
    this.modal.close(kept);
  }
}
