import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  FormlyExtension,
  FormlyFieldConfig,
  FormlyModule,
} from '@ngx-formly/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';
import { Subscription } from 'rxjs';
import { isPlainNumber } from '../variables/expression';
import { NumberInput } from '../variables/evaluate';
import { evaluateField, fieldScope } from '../variables/field';
import { Completion, roundForDisplay, suggest } from '../variables/suggest';

/** Below the box, or above it when there's no room. */
const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
];

/**
 * A number field that also takes an expression using the variables, e.g.
 * `width / 2 + 3`, and numbers with units (`1cm`). A plain number is kept as
 * a number; anything else is kept as typed (the pipelines work it out), with
 * its value shown beside it. Suggests variables, functions and units while
 * typing (Ctrl+Space for all of them).
 */
@Component({
  selector: 'formly-field-number',
  imports: [FormlyModule, OverlayModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .form-control {
      font-family: var(--bs-font-monospace);
    }
    .result {
      font-variant-numeric: tabular-nums;
      max-width: 50%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .suggestions {
      min-width: 14rem;
      max-height: 14rem;
      overflow-y: auto;
      margin: 2px 0;
      padding: 4px 0;
      list-style: none;
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: var(--bs-border-radius);
      box-shadow: var(--bs-box-shadow);
      font-family: var(--bs-font-monospace);
      font-size: 0.8rem;
    }
    .suggestions li {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      padding: 2px 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .suggestions li.active {
      background: var(--bs-primary-bg-subtle);
    }
    .kind {
      flex: 0 0 1ch;
      font-weight: bold;
    }
    .kind.variable {
      color: #7c3aed;
    }
    .kind.function {
      color: var(--bs-primary);
    }
    .kind.constant,
    .kind.unit {
      color: var(--bs-success);
    }
    .detail {
      margin-left: auto;
      color: var(--bs-secondary-color);
    }
  `,
  template: `
    <div class="input-group">
      <input
        #box
        type="text"
        class="form-control"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="!!completion"
        [attr.aria-controls]="completion ? id + '-suggestions' : null"
        [attr.aria-activedescendant]="
          completion ? id + '-suggestion-' + active : null
        "
        [value]="text"
        (input)="onInput($any($event.target))"
        (keydown)="onKeydown($event)"
        (click)="close()"
        (blur)="close()"
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
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="box"
      [cdkConnectedOverlayOpen]="!!completion"
      [cdkConnectedOverlayPositions]="positions"
      (detach)="close()"
    >
      <ul class="suggestions" role="listbox" [id]="id + '-suggestions'">
        @for (item of completion?.items; track item.label; let i = $index) {
          <li
            role="option"
            [id]="id + '-suggestion-' + i"
            [class.active]="i === active"
            [attr.aria-selected]="i === active"
            (mousedown)="$event.preventDefault(); accept(i)"
          >
            <span class="kind" [class]="item.kind">{{ item.kind[0] }}</span>
            <span>{{ item.label }}</span>
            <span class="detail">{{ item.detail }}</span>
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class NumberTypeComponent
  extends FieldType<FieldTypeConfig>
  implements OnInit, OnDestroy
{
  /** What's in the box (kept while typing, e.g. "1." or "a *"). */
  text = '';
  /** The suggestions for the word being typed, while they're shown. */
  completion: Completion | null = null;
  /** The highlighted suggestion. */
  active = 0;
  readonly positions = POSITIONS;
  private readonly box =
    viewChild.required<ElementRef<HTMLInputElement>>('box');
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

  onInput(input: HTMLInputElement) {
    this.setText(input.value);
    this.open(input, false);
  }

  onKeydown(event: KeyboardEvent) {
    const input = this.box().nativeElement;
    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      this.open(input, true);
      return;
    }
    const completion = this.completion;
    if (!completion) {
      return;
    }
    const count = completion.items.length;
    switch (event.key) {
      case 'ArrowDown':
        this.active = (this.active + 1) % count;
        break;
      case 'ArrowUp':
        this.active = (this.active - 1 + count) % count;
        break;
      case 'Enter':
      case 'Tab':
        this.accept(this.active);
        break;
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        this.close();
        return;
      default:
        return;
    }
    // Keep the key from also moving the caret, leaving the field, or
    // closing a dialog.
    event.preventDefault();
    event.stopPropagation();
    this.scrollToActive();
  }

  /** Puts suggestion `index` in place of the word being typed. */
  accept(index: number) {
    const completion = this.completion;
    const item = completion?.items[index];
    if (!completion || !item) {
      return;
    }
    const input = this.box().nativeElement;
    const text =
      this.text.slice(0, completion.from) +
      item.insert +
      this.text.slice(completion.to);
    const caret = completion.from + item.insert.length;
    input.value = text;
    input.setSelectionRange(caret, caret);
    this.setText(text);
    this.close();
  }

  close() {
    this.completion = null;
  }

  /** An expression's value, rounded for display. */
  get result(): string | null {
    if (typeof this.formControl.value !== 'string') {
      return null;
    }
    const result = evaluateField(this.field);
    return result && 'value' in result ? roundForDisplay(result.value) : null;
  }

  private setText(text: string) {
    this.text = text;
    this.formControl.setValue(parse(text));
    this.formControl.markAsDirty();
  }

  /** Suggestions for the word at the caret (`all`: even with none typed). */
  private open(input: HTMLInputElement, all: boolean) {
    const caret = input.selectionStart ?? input.value.length;
    this.completion =
      input.selectionEnd === caret
        ? suggest(input.value, caret, fieldScope(this.field), all)
        : null;
    this.active = 0;
  }

  private scrollToActive() {
    document
      .getElementById(`${this.id}-suggestion-${this.active}`)
      ?.scrollIntoView({ block: 'nearest' });
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
