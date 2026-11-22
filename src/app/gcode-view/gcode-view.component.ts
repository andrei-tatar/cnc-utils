import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { editor } from 'monaco-editor/editor/editor.api.js';
import {
  clampGcodeWidth,
  DEFAULT_GCODE_WIDTH,
  GcodeSection,
  GcodeView,
  saveGcodeWidth,
} from '../pipeline/gcode-view';
import { reportError } from '../pipeline/errors';

type Monaco = typeof import('./monaco');

let monaco: Promise<Monaco> | null = null;

/** Monaco and its stylesheet, fetched once (when the panel first opens). */
function loadMonaco(): Promise<Monaco> {
  monaco ??= Promise.all([
    import('./monaco'),
    new Promise<void>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'monaco.css';
      // (Without it the editor still works, only unstyled: carry on.)
      link.onload = link.onerror = () => resolve();
      document.head.appendChild(link);
    }),
  ]).then(([module]) => module);
  // A failed fetch is tried again the next time.
  monaco.catch(() => (monaco = null));
  return monaco;
}

/** Lines selected (from 0, both included). */
type Lines = { first: number; last: number };

/**
 * The program's G-code beside the preview, read-only, in a Monaco editor.
 * The lines selected (the caret's line, with nothing selected) are given
 * out for the preview to mark their moves on the toolpaths, so walking the
 * caret down the program walks the bit along them; `reveal` goes to a line
 * (a toolpath clicked in the preview), `revealOperation` to an operation's
 * first. Its left edge resizes it.
 */
@Component({
  selector: 'app-gcode-view',
  template: `
    <div
      class="handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize G-code"
      tabindex="0"
      title="Drag to resize · double-click to reset"
      [class.resizing]="resizing()"
      (pointerdown)="startResize($event)"
      (pointermove)="resize($event)"
      (pointerup)="endResize($event)"
      (pointercancel)="endResize($event)"
      (lostpointercapture)="endResize($event)"
      (dblclick)="setWidth(DEFAULT_GCODE_WIDTH)"
      (keydown.arrowleft)="setWidth(width() + 20)"
      (keydown.arrowright)="setWidth(width() - 20)"
    ></div>
    <div class="panel">
      <header>
        <strong>G-code</strong>
        <span class="count">{{ count() }}</span>
        <span class="spacer"></span>
        <button
          type="button"
          [disabled]="!view()"
          [title]="
            copied() ? 'Copied' : 'Copy the selected lines, or all of it'
          "
          aria-label="Copy"
          (click)="copy()"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            @if (copied()) {
              <path d="m3 8.5 3.5 3.5L13 4.5" />
            } @else {
              <path d="M5.5 5.5h8v8h-8zM3 10.5h-.5v-8h8V3" />
            }
          </svg>
        </button>
        <button
          type="button"
          title="Download the G-code (.nc, with the project in it)"
          aria-label="Download"
          (click)="download.emit()"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
          </svg>
        </button>
        <button
          type="button"
          title="Close (N)"
          aria-label="Close G-code"
          (click)="close.emit()"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      @if (operations().length > 1) {
        <select
          class="operations"
          aria-label="Go to an operation"
          title="Go to an operation"
          (change)="goToSection($any($event.target).value)"
        >
          @for (o of operations(); track $index) {
            <option [value]="o.first" [selected]="o === section()">
              {{ o.label }}
            </option>
          }
          @if (!section()?.label) {
            <option value="" selected disabled>
              {{ line() < (operations()[0]?.first ?? 0) ? 'Start' : 'End' }}
            </option>
          }
        </select>
      }
      <div class="editor" #editor>
        @if (!ready()) {
          <p class="note">{{ failed() || 'Loading the editor…' }}</p>
        }
      </div>
      <footer [class.stale]="working()">
        <span class="where">{{ where() }}</span>
        <span class="hint">{{
          working() ? 'working…' : 'click a toolpath to find its line'
        }}</span>
      </footer>
    </div>
  `,
  host: { '[style.width.px]': 'width()' },
  styles: `
    :host {
      flex: none;
      display: flex;
      min-width: 0;
      background: var(--editor-card-bg);
      color: var(--bs-body-color);
      font-size: 0.8rem;
    }

    .handle {
      flex: none;
      width: 6px;
      cursor: col-resize;
      background: var(--editor-border);
      position: relative;
      touch-action: none;
      transition: background-color 120ms ease;

      // Wider invisible hit area than the visible bar.
      &::before {
        content: '';
        position: absolute;
        inset: 0 -4px;
        z-index: 6;
      }

      &:hover,
      &:focus-visible,
      &.resizing {
        background: var(--bs-primary);
        outline: none;
      }
    }

    .panel {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--editor-section-bg);
      border-bottom: 1px solid var(--editor-border);

      .count {
        color: var(--editor-label-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .spacer {
        flex: 1;
      }

      button {
        flex: none;
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border: 1px solid transparent;
        border-radius: 6px;
        background: none;
        color: var(--editor-label-color);

        &:hover:not(:disabled) {
          color: var(--bs-body-color);
          background: var(--editor-hover-bg);
          border-color: var(--editor-border);
        }

        &:disabled {
          opacity: 0.4;
        }
      }

      svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }

    .operations {
      margin: 6px 8px;
      padding: 3px 6px;
      min-width: 0;
      border: 1px solid var(--editor-border);
      border-radius: 6px;
      background: var(--editor-card-bg);
      color: inherit;
      font-size: inherit;
      text-overflow: ellipsis;
    }

    .editor {
      flex: 1;
      min-height: 0;
      position: relative;
    }

    .note {
      margin: 12px;
      color: var(--editor-label-color);
    }

    footer {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 4px 8px;
      border-top: 1px solid var(--editor-border);
      background: var(--editor-section-bg);
      color: var(--editor-label-color);
      white-space: nowrap;

      .where {
        flex: none;
        font-family: var(--code-font);
      }

      .hint {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      &.stale .hint {
        color: var(--bs-primary);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GcodeViewComponent implements OnDestroy {
  readonly DEFAULT_GCODE_WIDTH = DEFAULT_GCODE_WIDTH;

  /** The program written out (null until it is). */
  readonly view = input<GcodeView | null>(null);
  readonly dark = input(false);
  /** Toolpaths are being worked out: what's shown is about to change. */
  readonly working = input(false);
  /** The panel's width, in pixels. */
  readonly width = model.required<number>();
  /**
   * The lines selected, for the preview to mark (null with no program).
   * Whoever closes the panel forgets them: nothing is said on the way out.
   */
  readonly lines = output<Lines | null>();
  readonly close = output();
  readonly download = output();

  readonly resizing = signal(false);
  readonly ready = signal(false);
  readonly failed = signal('');
  readonly copied = signal(false);
  /** The line the selection ends on (from 0). */
  readonly line = signal(0);
  private readonly selected = signal<Lines>({ first: 0, last: 0 });

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('editor');
  private editor: editor.IStandaloneCodeEditor | null = null;
  private monaco: Monaco | null = null;
  private destroyed = false;
  private frame = 0;
  private resizeOffset = 0;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** The program's operations, to go to. */
  readonly operations = computed(() =>
    (this.view()?.sections ?? []).filter((s) => s.label),
  );
  /** The stretch of the program the caret is in. */
  readonly section = computed((): GcodeSection | null => {
    const line = this.line();
    return (
      this.view()?.sections.find((s) => s.first <= line && line <= s.last) ??
      null
    );
  });
  readonly count = computed(() => {
    const lines = this.view()?.listing.lines.length;
    return lines === undefined ? '' : `${lines.toLocaleString('en')} lines`;
  });
  readonly where = computed(() => {
    const { first, last } = this.selected();
    return first === last
      ? `Ln ${(last + 1).toLocaleString('en')}`
      : `Ln ${(first + 1).toLocaleString('en')} – ${(last + 1).toLocaleString('en')} (${(last - first + 1).toLocaleString('en')} lines)`;
  });

  constructor() {
    loadMonaco().then(
      (module) => this.create(module),
      (error) => {
        this.failed.set('The editor couldn’t be loaded.');
        reportError('loading the G-code editor', error);
      },
    );
    // The program, as it changes; the theme, as the app's does.
    effect(() => {
      const view = this.view();
      if (this.ready()) untracked(() => this.show(view));
    });
    effect(() => {
      const dark = this.dark();
      if (this.ready()) this.monaco!.applyGcodeTheme(dark);
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.copiedTimer);
    const model = this.editor?.getModel();
    this.editor?.dispose();
    model?.dispose();
  }

  private create(module: Monaco) {
    if (this.destroyed) return;
    this.monaco = module;
    module.applyGcodeTheme(this.dark());
    const code = getComputedStyle(document.documentElement)
      .getPropertyValue('--code-font')
      .trim();
    this.editor = module.monaco.editor.create(this.host().nativeElement, {
      value: '',
      language: module.GCODE_LANGUAGE,
      theme: module.GCODE_THEME,
      readOnly: true,
      // (No keyboard popping up on a touch screen; the caret still moves.)
      domReadOnly: true,
      automaticLayout: true,
      fontFamily: code || undefined,
      fontSize: 12,
      lineNumbersMinChars: 4,
      folding: true,
      showFoldingControls: 'mouseover',
      minimap: { enabled: true, renderCharacters: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      // Words aren't code here: nothing to match or suggest.
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      matchBrackets: 'never',
      guides: { indentation: false },
      wordWrap: 'off',
      stickyScroll: { enabled: false },
      unicodeHighlight: { ambiguousCharacters: false },
    });
    this.editor.onDidChangeCursorSelection(() => this.selectionChanged());
    this.ready.set(true);
  }

  /** Puts `view` in the editor, the caret staying on its line. */
  private show(view: GcodeView | null) {
    const editor = this.editor;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const selection = editor.getSelection();
    const scrollTop = editor.getScrollTop();
    this.monaco!.setFolding(model, view?.sections ?? []);
    model.setValue(view ? view.listing.lines.join('\n') : '');
    if (selection && view) {
      const last = model.getLineCount();
      editor.setSelection({
        startLineNumber: Math.min(last, selection.startLineNumber),
        startColumn: selection.startColumn,
        endLineNumber: Math.min(last, selection.endLineNumber),
        endColumn: selection.endColumn,
      });
      editor.setScrollTop(scrollTop);
    }
    this.selectionChanged();
  }

  /** The selection moved: say which lines, once per frame. */
  private selectionChanged() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const selection = this.editor?.getSelection();
      if (!selection || !this.view()) {
        this.lines.emit(null);
        return;
      }
      const first = selection.startLineNumber - 1;
      let last = selection.endLineNumber - 1;
      // Whole lines selected end at the start of the next one.
      if (last > first && selection.endColumn === 1) last--;
      this.selected.set({ first, last });
      this.line.set(last);
      this.lines.emit({ first, last });
    });
  }

  /** Goes to `line` (from 0), the caret on it: its move is marked. */
  reveal(line: number) {
    const editor = this.editor;
    if (!editor) return;
    const lineNumber = line + 1;
    editor.setPosition({ lineNumber, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
    editor.focus();
  }

  /** Scrolls to where `operationId`'s G-code starts, if it has any. */
  revealOperation(operationId: string) {
    const section = this.view()?.sections.find(
      (s) => s.operationId === operationId,
    );
    if (section && this.section()?.operationId !== operationId) {
      this.editor?.revealLineNearTop(section.first + 1);
    }
  }

  goToSection(first: string) {
    if (first !== '') this.reveal(+first);
  }

  /** Copies the selected lines, or the whole program with none. */
  async copy() {
    const model = this.editor?.getModel();
    const selection = this.editor?.getSelection();
    if (!model) return;
    const text =
      selection && !selection.isEmpty()
        ? model.getValueInRange(selection)
        : model.getValue();
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 1500);
    } catch (error) {
      reportError('copying the G-code', error);
    }
  }

  startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing.set(true);
    // Keep the grab point under the cursor instead of snapping to it.
    this.resizeOffset = event.clientX + this.width();
    event.preventDefault();
  }

  resize(event: PointerEvent) {
    if (this.resizing()) {
      this.setWidth(this.resizeOffset - event.clientX, false);
    }
  }

  endResize(event: PointerEvent) {
    if (!this.resizing()) return;
    this.resizing.set(false);
    this.setWidth(this.width());
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  setWidth(width: number, persist = true) {
    const clamped = clampGcodeWidth(width);
    this.width.set(clamped);
    if (persist) saveGcodeWidth(clamped);
  }
}
