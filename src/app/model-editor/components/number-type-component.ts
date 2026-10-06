import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import {
  FormlyExtension,
  FormlyFieldConfig,
  FormlyModule,
} from '@ngx-formly/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';
import { Subscription } from 'rxjs';
import { isPlainNumber } from '../variables/expression';
import { NumberInput } from '../variables/evaluate';
import { evaluateField } from '../variables/field';

/**
 * A number field that also takes an expression using the variables, e.g.
 * `width / 2 + 3`. A plain number is kept as a number; anything else is
 * kept as typed (the pipelines work it out), with its value shown beside it.
 */
@Component({
  selector: 'formly-field-number',
  imports: [FormlyModule],
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
      <input
        type="text"
        class="form-control"
        autocomplete="off"
        spellcheck="false"
        [value]="text"
        (input)="onInput($any($event.target).value)"
        [disabled]="formControl.disabled"
        [formlyAttributes]="field"
        [class.is-invalid]="showError"
        [attr.aria-describedby]="id + '-formly-validation-error'"
        [attr.aria-invalid]="showError"
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
  private subscription?: Subscription;

  ngOnInit() {
    this.text = format(this.formControl.value);
    // Changes from elsewhere (a loaded project, a default value).
    this.subscription = this.formControl.valueChanges.subscribe((value) => {
      if (parse(this.text) !== value) {
        this.text = format(value);
      }
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  onInput(text: string) {
    this.text = text;
    this.formControl.setValue(parse(text));
    this.formControl.markAsDirty();
  }

  /** An expression's value, rounded for display. */
  get result(): string | null {
    if (typeof this.formControl.value !== 'string') {
      return null;
    }
    const result = evaluateField(this.field);
    return result && 'value' in result
      ? String(Math.round(result.value * 1e4) / 1e4)
      : null;
  }
}

function parse(text: string): NumberInput {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return isPlainNumber(trimmed) ? Number(trimmed) : trimmed;
}

function format(value: NumberInput): string {
  return value === null || value === undefined ? '' : String(value);
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
