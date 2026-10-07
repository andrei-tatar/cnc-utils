import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Input,
  signal,
  ViewChild,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { parsePathData } from '../../../cam/path-commands';

/**
 * Paste SVG path data (a `<path>`'s `d`) to turn into a path shape's
 * commands. Opens with the current path, selected, so pasting replaces it
 * (and it can be copied out). Closes with the commands when imported.
 */
@Component({
  selector: 'app-path-data-dialog',
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

    textarea {
      font-family: var(--code-font);
      font-variant-ligatures: none;
      font-size: 0.8rem;
      resize: vertical;
    }

    .outcome {
      min-height: 1.5em;
      margin: 6px 0 0;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
      overflow-wrap: anywhere;
    }

    .outcome.failed {
      color: var(--bs-danger-text-emphasis);
    }

    .excerpt {
      display: block;
      margin-top: 2px;
      font-family: var(--code-font);
      white-space: pre;
      overflow: hidden;
      text-overflow: ellipsis;

      mark {
        padding: 0;
        color: inherit;
        background: var(--bs-danger-bg-subtle);
        border-bottom: 2px solid var(--bs-danger);
      }
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
      <h2 class="modal-title" id="path-data-title">Import path data</h2>
    </div>
    <div
      class="modal-body"
      (keydown.control.enter)="import()"
      (keydown.meta.enter)="import()"
    >
      <p class="form-text mt-0 mb-2" id="path-data-help">
        SVG path data, e.g. a <code>&lt;path&gt;</code>'s <code>d</code>
        attribute.
      </p>
      <textarea
        #input
        id="path-data-text"
        aria-labelledby="path-data-title"
        aria-describedby="path-data-help"
        class="form-control"
        rows="6"
        spellcheck="false"
        autocomplete="off"
        [class.is-invalid]="outcome().failed"
        [value]="text()"
        (input)="text.set(input.value)"
      ></textarea>
      <p class="outcome" [class.failed]="outcome().failed" role="status">
        {{ outcome().text }}
        @if (outcome().excerpt; as excerpt) {
          <span class="excerpt"
            >{{ excerpt.before }}<mark>{{ excerpt.at }}</mark
            >{{ excerpt.after }}</span
          >
        }
      </p>
    </div>
    <div class="modal-footer">
      <span class="hint">Ctrl+Enter imports</span>
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
        [disabled]="!canImport()"
        (click)="import()"
      >
        Import
      </button>
    </div>
  `,
})
export class PathDataDialogComponent implements AfterViewInit {
  readonly modal = inject(NgbActiveModal);

  @ViewChild('input', { static: true })
  private input!: ElementRef<HTMLTextAreaElement>;

  @Input() set initialText(text: string) {
    this.text.set(text);
  }
  /** How many commands the shape has now (they're replaced). */
  @Input() replacing = 0;

  readonly text = signal('');
  private readonly parsed = computed(() => parsePathData(this.text()));

  readonly outcome = computed(() => {
    const parsed = this.parsed();
    if ('error' in parsed) {
      const { position } = parsed;
      const text = this.text();
      return {
        failed: true,
        text: `${parsed.error} (at character ${position + 1})`,
        excerpt: {
          before: text.slice(Math.max(0, position - 30), position),
          at: text[position] ?? ' ',
          after: text.slice(position + 1, position + 30),
        },
      };
    }
    const count = parsed.commands.length;
    if (!count) {
      return { failed: false, text: 'Paste path data to import.' };
    }
    const commands = `${count} ${count === 1 ? 'command' : 'commands'}`;
    return {
      failed: false,
      text: this.replacing
        ? `${commands}, in place of the ${this.replacing} there are now.`
        : `${commands}.`,
    };
  });

  readonly canImport = computed(() => {
    const parsed = this.parsed();
    return !('error' in parsed) && parsed.commands.length > 0;
  });

  ngAfterViewInit() {
    const input = this.input.nativeElement;
    input.focus();
    input.select();
  }

  import() {
    const parsed = this.parsed();
    if (this.canImport()) {
      this.modal.close(parsed.commands);
    }
  }
}
