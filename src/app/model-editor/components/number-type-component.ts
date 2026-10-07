import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import {
  FieldType,
  FieldTypeConfig,
  FormlyExtension,
  FormlyFieldConfig,
} from '@ngx-formly/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subscription } from 'rxjs';
import { evaluateField } from '../variables/field';
import { roundForDisplay } from '../variables/suggest';
import { ExpressionDialogComponent } from './expression-dialog.component';
import {
  ExpressionEditorComponent,
  formatNumberInput,
  toNumberInput,
} from './expression-editor.component';

/**
 * A number field that also takes an expression using the variables, e.g.
 * `width / 2 + 3`, and numbers with units (`1cm`). A plain number is kept as
 * a number; anything else is kept as typed (the pipelines work it out), with
 * its value shown beside it. The box (`ExpressionEditorComponent`) suggests
 * names and explains the expression's parts; a long expression can be
 * edited in a bigger box (`ExpressionDialogComponent`).
 */
@Component({
  selector: 'formly-field-number',
  imports: [ExpressionEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .result {
      font-variant-numeric: tabular-nums;
      max-width: 50%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
  template: `
    <div class="input-group">
      <app-expression-editor
        [field]="field"
        [id]="id"
        [text]="text"
        (textChange)="setText($event)"
        [invalid]="showError"
        [joined]="!!result"
        [expandable]="true"
        (expand)="openBigger()"
      />
      @if (result; as value) {
        <span class="input-group-text result" [title]="'= ' + value"
          >= {{ value }}</span
        >
      }
    </div>
  `,
})
export class NumberTypeComponent
  extends FieldType<FieldTypeConfig>
  implements OnInit, OnDestroy
{
  /** What's in the box (kept while typing, e.g. "1." or "a *"). */
  text = '';
  private readonly modals = inject(NgbModal);
  private subscription?: Subscription;

  ngOnInit() {
    this.text = formatNumberInput(this.formControl.value);
    // Changes from elsewhere (a loaded project, a default value).
    this.subscription = this.formControl.valueChanges.subscribe((value) => {
      if (toNumberInput(this.text) !== value) {
        this.text = formatNumberInput(value);
      }
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  /** An expression's value, rounded for display. */
  get result(): string | null {
    if (typeof this.formControl.value !== 'string') {
      return null;
    }
    const result = evaluateField(this.field);
    return result && 'value' in result ? roundForDisplay(result.value) : null;
  }

  setText(text: string) {
    this.text = text;
    this.formControl.setValue(toNumberInput(text));
    this.formControl.markAsDirty();
  }

  /** Edits the expression in a bigger box, applied when that's closed so. */
  async openBigger() {
    const ref = this.modals.open(ExpressionDialogComponent, {
      size: 'lg',
      scrollable: true,
      ariaLabelledBy: 'expression-title',
    });
    Object.assign(ref.componentInstance, {
      field: this.field,
      title: this.props.label || this.model?.name?.trim() || 'Expression',
      initialText: this.text,
    });
    const text: string | false = await ref.result.catch(() => false);
    if (text !== false && text !== this.text) {
      this.setText(text);
      this.formControl.markAsTouched();
    }
  }
}

/**
 * Checks a number field's expression, and its `min` and `max` against the
 * value it works out to. (Angular's own min and max would read "2 * a" as
 * 2, so number fields keep their limits in `numberMin` / `numberMax`.)
 */
function numberValidator(
  _: AbstractControl,
  field: FormlyFieldConfig,
): ValidationErrors | null {
  const result = evaluateField(field);
  if (!result) {
    return null;
  }
  if ('error' in result) {
    return { expression: { message: result.error } };
  }
  const min = field.props?.['numberMin'];
  const max = field.props?.['numberMax'];
  if (typeof min === 'number' && result.value < min) {
    return { min: { min, actual: result.value } };
  }
  if (typeof max === 'number' && result.value > max) {
    return { max: { max, actual: result.value } };
  }
  return null;
}

/** Gives every number field the expression-aware checks above. */
export const numberExpressionExtension: FormlyExtension = {
  prePopulate(field: FormlyFieldConfig) {
    if (field.type !== 'number') {
      return;
    }
    const props = (field.props ??= {});
    for (const [from, to] of [
      ['min', 'numberMin'],
      ['max', 'numberMax'],
    ] as const) {
      if (props[from] !== undefined) {
        props[to] = props[from];
        delete props[from];
      }
    }
    const validation = field.validators?.validation ?? [];
    if (!validation.includes(numberValidator)) {
      field.validators = {
        ...field.validators,
        validation: [...validation, numberValidator],
      };
    }
  },
};
