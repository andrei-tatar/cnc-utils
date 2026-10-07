import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
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
import {
  Explained,
  explainExpression,
  isPlainNumber,
} from '../variables/expression';
import { NumberInput } from '../variables/evaluate';
import { evaluateField, fieldScope, formVariables } from '../variables/field';
import { highlight, Span } from '../variables/highlight';
import { Completion, roundForDisplay, suggest } from '../variables/suggest';

/** Below the box, or above it when there's no room. */
const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
];

/** A tooltip above a token, or below it when there's no room. */
const TIP_POSITIONS: ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -4,
  },
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: 4,
  },
];

/**
 * A number field that also takes an expression using the variables, e.g.
 * `width / 2 + 3`, and numbers with units (`1cm`). A plain number is kept as
 * a number; anything else is kept as typed (the pipelines work it out), with
 * its value shown beside it. Suggests variables, functions and units while
 * typing (Ctrl+Space for all of them), colours the expression's parts and
 * shows what each part works out to when it's hovered.
 */
@Component({
  selector: 'formly-field-number',
  imports: [FormlyModule, OverlayModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* The box's own text is invisible: the coloured copy on top shows it
       (it lets clicks through, and the caret and selection show under it). */
    .code {
      position: relative;
      flex: 1 1 auto;
      width: 1%;
      min-width: 0;
    }
    .code > .form-control {
      width: 100%;
      font-family: var(--code-font);
      font-variant-ligatures: none;
    }
    .code.colored > input {
      color: transparent;
      caret-color: var(--bs-body-color);
    }
    .code.colored > input::selection {
      color: transparent;
      background: rgba(var(--bs-primary-rgb), 0.25);
    }
    .code.joined > input {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    /* Padded like the box (an error icon too), and clipped to where the
       box shows text. */
    .code > .highlight {
      position: absolute;
      inset: 0;
      z-index: 6;
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      pointer-events: none;
    }
    .highlight > .text {
      overflow: hidden;
      white-space: pre;
    }
    /* Room to scroll as far as the box does. */
    .room {
      display: inline-block;
      width: 100%;
    }
    .number {
      color: var(--code-number);
    }
    .unit {
      color: var(--code-unit);
    }
    .variable {
      color: var(--code-variable);
      font-weight: 500;
    }
    .constant {
      color: var(--code-constant);
    }
    .function {
      color: var(--code-function);
    }
    .operator,
    .paren {
      color: var(--code-operator);
    }
    .unknown {
      color: var(--code-error);
      text-decoration: wavy underline;
      text-decoration-skip-ink: none;
    }
    .error {
      color: var(--code-error);
      background: var(--bs-danger-bg-subtle);
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
      font-family: var(--code-font);
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
    .in-part {
      background: rgba(var(--bs-primary-rgb), 0.12);
    }
    .tip {
      display: flex;
      gap: 0.5em;
      max-width: min(32rem, 90vw);
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(var(--bs-emphasis-color-rgb), 0.9);
      color: var(--bs-body-bg);
      font-family: var(--code-font);
      font-size: 0.75rem;
      white-space: nowrap;
      pointer-events: none;
    }
    .tip .expr {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.75;
    }
    .tip .value {
      flex: none;
      font-weight: 500;
    }
    .tip .value.failed {
      color: #ff9b9b;
    }
    .detail {
      margin-left: auto;
      color: var(--bs-secondary-color);
    }
  `,
  template: `
    <div class="input-group">
      <div class="code" [class.colored]="spans.length" [class.joined]="result">
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
          (click)="close(); syncScroll()"
          (keyup)="syncScroll()"
          (scroll)="syncScroll()"
          (blur)="close(); syncScroll()"
          [disabled]="formControl.disabled"
          [formlyAttributes]="field"
          [class.is-invalid]="showError"
          [attr.aria-describedby]="id + '-formly-validation-error'"
          [attr.aria-invalid]="showError"
        />
        @if (spans.length) {
          <div
            class="form-control highlight"
            [class.is-invalid]="showError"
            aria-hidden="true"
          >
            <div #highlight class="text">
              @for (span of spans; track $index) {
                <span
                  [class]="span.kind"
                  [class.in-part]="
                    hover && span.from >= hover.from && span.from < hover.to
                  "
                  [attr.data-i]="$index"
                  >{{ span.text }}</span
                >
              }
              <span class="room"></span>
            </div>
          </div>
        }
      </div>
      @if (result; as value) {
        <span class="input-group-text result" [title]="'= ' + value"
          >= {{ value }}</span
        >
      }
    </div>
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="hover?.element ?? box"
      [cdkConnectedOverlayOpen]="!!hover"
      [cdkConnectedOverlayPositions]="tipPositions"
    >
      <div class="tip" role="tooltip">
        @if (hover?.expr) {
          <span class="expr">{{ hover?.expr }}</span>
        }
        <span class="value" [class.failed]="hover?.failed">{{
          hover?.result
        }}</span>
      </div>
    </ng-template>
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
  implements OnInit, AfterViewInit, OnDestroy
{
  /** What's in the box (kept while typing, e.g. "1." or "a *"). */
  text = '';
  /** The suggestions for the word being typed, while they're shown. */
  completion: Completion | null = null;
  /** The highlighted suggestion. */
  active = 0;
  readonly positions = POSITIONS;
  readonly tipPositions = TIP_POSITIONS;
  /** The name under the pointer, and what to say about it. */
  hover: Hover = null;
  private readonly changes = inject(ChangeDetectorRef);
  private stopHovering?: () => void;
  private readonly box =
    viewChild.required<ElementRef<HTMLInputElement>>('box');
  private readonly highlightLayer =
    viewChild<ElementRef<HTMLElement>>('highlight');
  private highlighted?: {
    text: string;
    variables: object | null;
    spans: Span[];
    explained: Explained[];
  };
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

  ngAfterViewInit() {
    // Listened to directly: a template listener would check the whole form
    // on every mouse move.
    const input = this.box().nativeElement;
    const move = (event: MouseEvent) =>
      this.setHover(this.tokenAt(event.clientX, event.clientY));
    const leave = () => this.setHover(null);
    input.addEventListener('mousemove', move);
    input.addEventListener('mouseleave', leave);
    this.stopHovering = () => {
      input.removeEventListener('mousemove', move);
      input.removeEventListener('mouseleave', leave);
    };
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
    this.stopHovering?.();
  }

  onInput(input: HTMLInputElement) {
    this.hover = null;
    this.setText(input.value);
    this.open(input, false);
    requestAnimationFrame(() => this.syncScroll());
  }

  onKeydown(event: KeyboardEvent) {
    this.hover = null;
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
    requestAnimationFrame(() => this.syncScroll());
  }

  close() {
    this.completion = null;
  }

  /** The text in coloured pieces. */
  get spans(): Span[] {
    return this.worked().spans;
  }

  /** The pieces and what each works out to, for the current text. */
  private worked(): { spans: Span[]; explained: Explained[] } {
    if (!this.text.trim()) {
      return { spans: [], explained: [] };
    }
    // Worked out again only when the text or the variables change (a plain
    // number has none).
    const variables = isPlainNumber(this.text)
      ? null
      : formVariables(this.field);
    const last = this.highlighted;
    if (last?.text !== this.text || last.variables !== variables) {
      const scope = variables ? fieldScope(this.field) : new Map();
      this.highlighted = {
        text: this.text,
        variables,
        spans: highlight(this.text, scope),
        explained: explainExpression(this.text, scope),
      };
    }
    return this.highlighted!;
  }

  /** Scrolls the coloured copy along with the box. */
  syncScroll() {
    const layer = this.highlightLayer()?.nativeElement;
    if (layer) {
      layer.scrollLeft = this.box().nativeElement.scrollLeft;
    }
  }

  /** An expression's value, rounded for display. */
  get result(): string | null {
    if (typeof this.formControl.value !== 'string') {
      return null;
    }
    const result = evaluateField(this.field);
    return result && 'value' in result ? roundForDisplay(result.value) : null;
  }

  /** The token at a point, and what its part works out to. */
  private tokenAt(x: number, y: number): Hover {
    const layer = this.highlightLayer()?.nativeElement;
    for (const element of layer?.querySelectorAll('[data-i]') ?? []) {
      const box = element.getBoundingClientRect();
      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) {
        continue;
      }
      const { spans, explained } = this.worked();
      const span = spans[Number(element.getAttribute('data-i'))];
      const part =
        span && explained.find((p) => span.from >= p.at && span.from < p.end);
      return part ? this.describe(element, part) : null;
    }
    return null;
  }

  /**
   * What to say about a token: its part (`sqrt(a)`, `a * 2`) and its
   * value, or why it has none.
   */
  private describe(element: Element, part: Explained): Hover {
    const { from, to } = part;
    const expr = this.text.slice(from, to);
    if ('value' in part) {
      const value = roundForDisplay(part.value);
      return expr === value
        ? { element, from, to, expr: null, result: value, failed: false }
        : { element, from, to, expr, result: `= ${value}`, failed: false };
    }
    const name = part.error.unknownName;
    const result = name ? this.whyUnusable(name) : part.error.message;
    // A single token (a name) needs no repeating.
    const alone = from === part.at && to === part.end;
    return {
      element,
      from,
      to,
      expr: alone ? null : expr,
      result,
      failed: true,
    };
  }

  /** Why a name that isn't a usable variable here can't be used. */
  private whyUnusable(name: string): string {
    const { scope, unusable } = formVariables(this.field);
    if (scope.has(name)) {
      // Only the variables above a variable are usable in its value.
      return name === this.model?.name?.trim()
        ? `“${name}” can’t use itself`
        : `“${name}” is defined further down`;
    }
    return unusable.get(name) ?? `unknown variable “${name}”`;
  }

  private setHover(hover: Hover) {
    const current = this.hover;
    if (
      hover?.element !== current?.element ||
      hover?.from !== current?.from ||
      hover?.to !== current?.to ||
      hover?.result !== current?.result
    ) {
      this.hover = hover;
      this.changes.markForCheck();
    }
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

/** The hovered token, its part of the expression and what to say. */
type Hover = {
  element: Element;
  from: number;
  to: number;
  expr: string | null;
  result: string;
  failed: boolean;
} | null;

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
