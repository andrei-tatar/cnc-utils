import {
  afterNextRender,
  AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import {
  ConnectedPosition,
  FlexibleConnectedPositionStrategyOrigin,
  OverlayModule,
} from '@angular/cdk/overlay';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import {
  Explained,
  explainExpression,
  isPlainNumber,
} from '../variables/expression';
import { NumberInput } from '../variables/evaluate';
import { fieldScope, fieldVariables, formVariables } from '../variables/field';
import { highlight, Span } from '../variables/highlight';
import { Completion, roundForDisplay, suggest } from '../variables/suggest';

/** Below the box (or the word), or above it when there's no room. */
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
 * The box a number field's expression is typed in: one line in the form, or
 * (`multiline`) a box that grows with the text, wrapping it, in the bigger
 * editor. Suggests variables, functions and units while typing (Ctrl+Space
 * for all of them), colours the expression's parts and shows what each part
 * works out to when it's hovered. `field` is the number field, for the
 * variables it can use.
 */
@Component({
  selector: 'app-expression-editor',
  imports: [FormlyModule, OverlayModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      display: contents;
    }
    /* The box's own text is invisible: the coloured copy on top shows it
       (it lets clicks through, and the caret and selection show under it). */
    .code {
      position: relative;
      flex: 1 1 auto;
      width: 1%;
      min-width: 0;
    }
    .code.multiline {
      width: 100%;
    }
    .code > .form-control {
      width: 100%;
      font-family: var(--code-font);
      font-variant-ligatures: none;
    }
    .code.colored > .form-control:not(.highlight) {
      color: transparent;
      caret-color: var(--bs-body-color);
    }
    .code.colored > .form-control::selection {
      color: transparent;
      background: rgba(var(--bs-primary-rgb), 0.25);
    }
    .code.joined > input {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    /* Grows with the text instead (see fit()). */
    .code > textarea {
      overflow: hidden;
      resize: none;
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
    /* Wrapped as the text area wraps. */
    .multiline > .highlight > .text {
      overflow: visible;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    /* Room to scroll as far as the box does. */
    .room {
      display: inline-block;
      width: 100%;
    }
    /* At the box's end (before an error icon) while it's hovered or in
       use, with the text kept clear of it. */
    .expand {
      position: absolute;
      top: 50%;
      right: 3px;
      z-index: 7;
      display: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      transform: translateY(-50%);
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--bs-secondary-color);
    }
    .expand:hover,
    .expand:focus-visible {
      background: var(--bs-tertiary-bg);
      color: var(--bs-body-color);
    }
    .expand svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .code.expandable:is(:hover, :focus-within) > .expand {
      display: flex;
    }
    .code.expandable:is(:hover, :focus-within) > .form-control {
      padding-right: 28px;
    }
    .code.expandable:is(:hover, :focus-within) > .form-control.is-invalid {
      padding-right: calc(1.5em + 0.75rem + 22px);
    }
    .code.invalid > .expand {
      right: 26px;
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
    <div
      #code
      class="code"
      [class.colored]="spans.length"
      [class.joined]="joined()"
      [class.multiline]="multiline()"
      [class.expandable]="expandable() && !disabled"
      [class.invalid]="invalid()"
    >
      @if (multiline()) {
        <textarea
          #box
          class="form-control"
          rows="6"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          ngbAutofocus
          [attr.aria-label]="label()"
          [attr.aria-expanded]="!!completion"
          [attr.aria-controls]="completion ? id() + '-suggestions' : null"
          [attr.aria-activedescendant]="
            completion ? id() + '-suggestion-' + active : null
          "
          [value]="shown"
          (input)="onInput($any($event.target))"
          (keydown)="onKeydown($event)"
          (click)="close()"
          (blur)="close()"
          [class.is-invalid]="invalid()"
          [attr.aria-invalid]="invalid()"
        ></textarea>
      } @else {
        <input
          #box
          type="text"
          class="form-control"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="!!completion"
          [attr.aria-controls]="completion ? id() + '-suggestions' : null"
          [attr.aria-activedescendant]="
            completion ? id() + '-suggestion-' + active : null
          "
          [value]="shown"
          (input)="onInput($any($event.target))"
          (keydown)="onKeydown($event)"
          (click)="close(); syncScroll()"
          (keyup)="syncScroll()"
          (scroll)="syncScroll()"
          (blur)="close(); syncScroll()"
          [disabled]="disabled"
          [formlyAttributes]="field()"
          [class.is-invalid]="invalid()"
          [attr.aria-describedby]="id() + '-formly-validation-error'"
          [attr.aria-invalid]="invalid()"
        />
      }
      @if (spans.length) {
        <div
          class="form-control highlight"
          [class.is-invalid]="invalid()"
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
            @if (!multiline()) {
              <span class="room"></span>
            }
          </div>
        </div>
      }
      @if (expandable() && !disabled) {
        <button
          type="button"
          class="expand"
          title="Edit in a bigger box (Alt+Enter)"
          aria-label="Edit in a bigger box"
          (click)="expand.emit()"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
          </svg>
        </button>
      }
    </div>
    <!-- Escape is the box's (it closes the suggestions, or else a dialog
         the box is in), so the overlays don't take it. -->
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="hover?.element ?? code"
      [cdkConnectedOverlayOpen]="!!hover"
      [cdkConnectedOverlayPositions]="tipPositions"
      [cdkConnectedOverlayDisableClose]="true"
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
      [cdkConnectedOverlayOrigin]="(multiline() && anchor) || code"
      [cdkConnectedOverlayOpen]="!!completion && (!multiline() || !!anchor)"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayDisableClose]="true"
      (detach)="close()"
    >
      <ul class="suggestions" role="listbox" [id]="id() + '-suggestions'">
        @for (item of completion?.items; track item.label; let i = $index) {
          <li
            role="option"
            [id]="id() + '-suggestion-' + i"
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
export class ExpressionEditorComponent implements AfterViewInit, OnDestroy {
  /** The number field the expression is for. */
  readonly field = input.required<FormlyFieldConfig>();
  /** For the suggestions' ids. */
  readonly id = input.required<string>();
  /** The expression (kept as typed, e.g. "1." or "a *"). */
  readonly text = model.required<string>();
  /** A growing, wrapping box (line breaks kept) instead of one line. */
  readonly multiline = input(false, { transform: booleanAttribute });
  readonly invalid = input(false);
  /** Something sits right beside the (one-line) box. */
  readonly joined = input(false);
  /** Offers the bigger editor (`expand`): a button, and Alt+Enter. */
  readonly expandable = input(false);
  /** The text area's name, for screen readers. */
  readonly label = input<string>();
  readonly expand = output<void>();

  /** The suggestions for the word being typed, while they're shown. */
  completion: Completion | null = null;
  /** The highlighted suggestion. */
  active = 0;
  /** Where the word being completed is, in the growing box. */
  anchor: FlexibleConnectedPositionStrategyOrigin | null = null;
  readonly positions = POSITIONS;
  readonly tipPositions = TIP_POSITIONS;
  /** The name under the pointer, and what to say about it. */
  hover: Hover = null;
  private readonly changes = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private stopListening?: () => void;
  private readonly box =
    viewChild.required<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(
      'box',
    );
  private readonly highlightLayer =
    viewChild<ElementRef<HTMLElement>>('highlight');
  private highlighted?: {
    text: string;
    variables: object | null;
    spans: Span[];
    explained: Explained[];
  };

  ngAfterViewInit() {
    // Listened to directly: a template listener would check the whole form
    // on every mouse move.
    const box = this.box().nativeElement;
    const element: HTMLElement = box;
    const move = (event: MouseEvent) =>
      this.setHover(this.tokenAt(event.clientX, event.clientY));
    const leave = () => this.setHover(null);
    element.addEventListener('mousemove', move);
    element.addEventListener('mouseleave', leave);
    // The growing box fits its text again when its width changes.
    const resizes = this.multiline()
      ? new ResizeObserver(() => this.fit())
      : null;
    resizes?.observe(box);
    if (this.multiline()) {
      // Ready to carry on at the end.
      box.setSelectionRange(box.value.length, box.value.length);
    }
    this.stopListening = () => {
      element.removeEventListener('mousemove', move);
      element.removeEventListener('mouseleave', leave);
      resizes?.disconnect();
    };
  }

  ngOnDestroy() {
    this.stopListening?.();
  }

  /**
   * Can't be typed in: disabled, or read-only (`props.readonly`, a value
   * worked out elsewhere; its control stays enabled, so it's still in the
   * form's value).
   */
  get disabled(): boolean {
    return (
      !!this.field().formControl?.disabled || !!this.field().props?.readonly
    );
  }

  /**
   * The text as the box shows it: on one line, line breaks (from the bigger
   * editor) are spaces, so positions in it are positions in the text.
   */
  get shown(): string {
    const text = this.text();
    return this.multiline() ? text : text.replace(/\n/g, ' ');
  }

  onInput(box: HTMLInputElement | HTMLTextAreaElement) {
    this.hover = null;
    this.text.set(box.value);
    this.fit();
    this.open(box, false);
    requestAnimationFrame(() => this.syncScroll());
  }

  onKeydown(event: KeyboardEvent) {
    this.hover = null;
    const box = this.box().nativeElement;
    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      this.open(box, true);
      return;
    }
    if (
      event.key === 'Enter' &&
      event.altKey &&
      this.expandable() &&
      !this.disabled
    ) {
      event.preventDefault();
      this.close();
      this.expand.emit();
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
    const box = this.box().nativeElement;
    const shown = this.shown;
    const text =
      shown.slice(0, completion.from) +
      item.insert +
      shown.slice(completion.to);
    const caret = completion.from + item.insert.length;
    box.value = text;
    box.setSelectionRange(caret, caret);
    this.text.set(text);
    this.fit();
    this.close();
    requestAnimationFrame(() => this.syncScroll());
  }

  close() {
    this.completion = null;
    this.anchor = null;
  }

  /** The text in coloured pieces. */
  get spans(): Span[] {
    return this.worked().spans;
  }

  /** The pieces and what each works out to, for the current text. */
  private worked(): { spans: Span[]; explained: Explained[] } {
    const text = this.shown;
    if (!text.trim()) {
      return { spans: [], explained: [] };
    }
    // Worked out again only when the text or the variables change (a plain
    // number has none).
    const variables = isPlainNumber(text) ? null : formVariables(this.field());
    const last = this.highlighted;
    if (last?.text !== text || last.variables !== variables) {
      const scope = variables ? fieldScope(this.field()) : new Map();
      this.highlighted = {
        text,
        variables,
        spans: highlight(text, scope),
        explained: explainExpression(text, scope),
      };
    }
    return this.highlighted!;
  }

  /** Scrolls the coloured copy along with the (one-line) box. */
  syncScroll() {
    const layer = this.highlightLayer()?.nativeElement;
    if (layer && !this.multiline()) {
      layer.scrollLeft = this.box().nativeElement.scrollLeft;
    }
  }

  /** Makes the growing box as tall as its text (at least its rows). */
  private fit() {
    const box = this.box().nativeElement;
    if (box instanceof HTMLTextAreaElement) {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
    }
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
    const expr = this.shown.slice(from, to);
    if ('value' in part) {
      const value = roundForDisplay(part.value);
      return expr === value
        ? { element, from, to, expr: null, result: value, failed: false }
        : { element, from, to, expr, result: `= ${value}`, failed: false };
    }
    const name = part.error.unknownName;
    const result = name
      ? (fieldVariables(this.field()).unusable.get(name) ??
        `unknown variable “${name}”`)
      : part.error.message;
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

  /** Suggestions for the word at the caret (`all`: even with none typed). */
  private open(box: HTMLInputElement | HTMLTextAreaElement, all: boolean) {
    const caret = box.selectionStart ?? box.value.length;
    const completion =
      box.selectionEnd === caret
        ? suggest(box.value, caret, fieldScope(this.field()), all)
        : null;
    this.completion = completion;
    this.active = 0;
    if (completion && this.multiline()) {
      // Under the word, once the coloured copy shows the new text.
      afterNextRender(
        () => {
          if (this.completion === completion) {
            this.anchor = this.pointAt(completion.from);
            this.changes.markForCheck();
          }
        },
        { injector: this.injector },
      );
    }
  }

  /** Where character `at` of the text is on the screen, a line high. */
  private pointAt(at: number): FlexibleConnectedPositionStrategyOrigin {
    const layer = this.highlightLayer()?.nativeElement;
    let rest = at;
    let last: Text | null = null;
    for (const element of layer?.querySelectorAll('[data-i]') ?? []) {
      const node = element.firstChild;
      if (!(node instanceof Text)) continue;
      if (rest < node.length) {
        return rectAt(node, rest);
      }
      rest -= node.length;
      last = node;
    }
    return last ? rectAt(last, last.length) : this.box();
  }

  private scrollToActive() {
    document
      .getElementById(`${this.id()}-suggestion-${this.active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }
}

/** What a number field keeps for `text`: a plain number as a number. */
export function toNumberInput(text: string): NumberInput {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return isPlainNumber(trimmed) ? Number(trimmed) : trimmed;
}

/** How a number field's value is typed. */
export function formatNumberInput(value: NumberInput): string {
  return value === null || value === undefined ? '' : String(value);
}

/** A text position's place on the screen, a line high. */
function rectAt(node: Text, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const rect =
    range.getClientRects()[0] ?? node.parentElement!.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: 0, height: rect.height };
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
