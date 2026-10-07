import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
  signal,
} from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { evaluateNumber } from '../variables/evaluate';
import { fieldVariables } from '../variables/field';
import { roundForDisplay } from '../variables/suggest';
import {
  ExpressionEditorComponent,
  toNumberInput,
} from './expression-editor.component';

/**
 * A bigger box for a number field's expression: it wraps, takes line
 * breaks, and shows what the expression works out to as it's typed. Closes
 * with the text when applied (Ctrl+Enter); the field keeps its value until
 * then.
 */
@Component({
  selector: 'app-expression-dialog',
  imports: [ExpressionEditorComponent],
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

    .outcome {
      min-height: 1.5em;
      margin: 6px 0 0;
      font-family: var(--code-font);
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
      color: var(--bs-secondary-color);
      overflow-wrap: anywhere;
    }

    .outcome.failed {
      color: var(--bs-danger-text-emphasis);
    }

    .modal-footer {
      border-top: none;
      padding-top: 0;
    }

    .hint {
      margin-right: auto;
      font-size: 0.75rem;
      color: var(--bs-secondary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="modal-header">
      <h2 class="modal-title" id="expression-title">{{ title }}</h2>
    </div>
    <div
      class="modal-body"
      (keydown.control.enter)="apply()"
      (keydown.meta.enter)="apply()"
    >
      <app-expression-editor
        multiline
        [field]="field"
        [id]="(field.id ?? 'expression') + '-bigger'"
        [label]="title"
        [text]="text()"
        (textChange)="text.set($event)"
        [invalid]="!!outcome()?.failed"
      />
      <p class="outcome" [class.failed]="outcome()?.failed" role="status">
        {{ outcome()?.text }}
      </p>
    </div>
    <div class="modal-footer">
      <span class="hint">Ctrl+Enter applies</span>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        (click)="modal.dismiss()"
      >
        Cancel
      </button>
      <button type="button" class="btn btn-sm btn-primary" (click)="apply()">
        Apply
      </button>
    </div>
  `,
})
export class ExpressionDialogComponent {
  readonly modal = inject(NgbActiveModal);

  /** The number field being edited. */
  @Input({ required: true }) field!: FormlyFieldConfig;
  @Input() title = 'Expression';
  @Input() set initialText(text: string) {
    this.text.set(text);
  }

  readonly text = signal('');
  /** What the text works out to, or why it can't be. */
  readonly outcome = computed(() => {
    const result = evaluateNumber(
      toNumberInput(this.text()),
      fieldVariables(this.field),
    );
    if (!result) {
      return null;
    }
    return 'value' in result
      ? { text: `= ${roundForDisplay(result.value)}`, failed: false }
      : { text: result.error, failed: true };
  });

  apply() {
    this.modal.close(this.text());
  }
}
