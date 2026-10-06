import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  OnInit,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describeTool, ToolType } from '../tools';
import {
  exportLibrary,
  importLibrary,
  LibraryEntry,
  LibraryTool,
  listLibrary,
  removeFromLibrary,
  saveToLibrary,
} from '../tools/tool-library';
import { downloadFile } from '../../project-file';
import { readFile } from '../../../util';

/**
 * The tool library, shared by every project: add its tools to this project,
 * keep this project's tools in it, and move it between browsers as a file.
 */
@Component({
  selector: 'app-tool-library-dialog',
  styles: `
    .modal-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .modal-body {
      font-size: 0.875rem;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    h3 {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #ea580c;
      margin: 0 0 6px;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--editor-border, #dde2ea);
      border-radius: 8px;
      overflow: hidden;
    }

    li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;

      & + li {
        border-top: 1px solid var(--editor-border, #dde2ea);
      }
    }

    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail {
      color: var(--bs-secondary-color);
      font-size: 0.75rem;
      margin-left: 6px;
    }

    .empty {
      color: var(--bs-secondary-color);
      font-style: italic;
      padding: 4px 2px;
    }

    .status {
      font-size: 0.8rem;
      color: var(--bs-success-text-emphasis);
    }

    .status--error {
      color: var(--bs-danger);
    }

    .modal-footer {
      justify-content: space-between;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="modal-header">
      <h2 class="modal-title" id="library-title">Tool library</h2>
      <button
        type="button"
        class="btn-close"
        aria-label="Close"
        (click)="modal.dismiss()"
      ></button>
    </div>
    <div class="modal-body">
      <section>
        <h3>In the library</h3>
        @if (entries().length) {
          <ul>
            @for (entry of entries(); track entry.key) {
              <li>
                <span class="name"
                  >{{ entry.tool.name || describe(entry.tool) }}
                  @if (entry.tool.name) {
                    <span class="detail">{{ describe(entry.tool) }}</span>
                  }
                </span>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary"
                  (click)="add(entry)"
                >
                  Add to project
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  [attr.aria-label]="
                    'Remove from library: ' + describe(entry.tool)
                  "
                  title="Remove from the library"
                  (click)="remove(entry)"
                >
                  Remove
                </button>
              </li>
            }
          </ul>
        } @else {
          <div class="empty">
            The library is empty. Keep this project's tools in it below, or
            import a library file.
          </div>
        }
      </section>

      @if (projectTools.length) {
        <section>
          <h3>This project's tools</h3>
          <ul>
            @for (tool of projectTools; track tool.id) {
              <li>
                <span class="name"
                  >{{ tool.name || describe(tool) }}
                  @if (tool.name) {
                    <span class="detail">{{ describe(tool) }}</span>
                  }
                </span>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  (click)="keep(tool)"
                  [title]="
                    tool.name
                      ? 'Saves it, replacing a library tool of the same name'
                      : 'Saves it to the library'
                  "
                >
                  Keep in library
                </button>
              </li>
            }
          </ul>
        </section>
      }

      @if (status(); as s) {
        <div class="status" [class.status--error]="s.error" role="status">
          {{ s.text }}
        </div>
      }
    </div>
    <div class="modal-footer">
      <div class="d-flex gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          (click)="importFile()"
        >
          Import…
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          [disabled]="!entries().length"
          (click)="exportFile()"
        >
          Export
        </button>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        (click)="modal.close()"
      >
        Done
      </button>
    </div>
  `,
})
export class ToolLibraryDialogComponent implements OnInit {
  readonly modal = inject(NgbActiveModal);

  /** The tools of the open project. */
  @Input() projectTools: ToolType[] = [];
  /** Adds a library tool to the project. */
  @Input() addToProject: (tool: LibraryTool) => void = () => {};

  readonly entries = signal<LibraryEntry[]>([]);
  readonly status = signal<{ text: string; error?: boolean } | null>(null);

  ngOnInit() {
    this.refresh();
  }

  describe(tool: LibraryTool) {
    return describeTool(tool);
  }

  add(entry: LibraryEntry) {
    this.addToProject(structuredClone(entry.tool));
    this.status.set({
      text: `Added “${this.label(entry.tool)}” to the project.`,
    });
  }

  async remove(entry: LibraryEntry) {
    await removeFromLibrary(entry.key);
    this.status.set({ text: `Removed “${this.label(entry.tool)}”.` });
    await this.refresh();
  }

  async keep(tool: ToolType) {
    try {
      await saveToLibrary(tool);
      this.status.set({ text: `Kept “${this.label(tool)}” in the library.` });
    } catch (error) {
      this.status.set({
        text: String((error as Error).message ?? error),
        error: true,
      });
    }
    await this.refresh();
  }

  async exportFile() {
    downloadFile(await exportLibrary(), 'cnc-utils-tools.json');
  }

  importFile() {
    readFile('.json,application/json').subscribe(async (file) => {
      try {
        const count = await importLibrary(await file.text());
        this.status.set({
          text: `Imported ${count} tool${count === 1 ? '' : 's'}.`,
        });
      } catch (error) {
        this.status.set({
          text: `Couldn't import “${file.name}”: ${(error as Error).message}`,
          error: true,
        });
      }
      await this.refresh();
    });
  }

  private label(tool: LibraryTool) {
    return tool.name || describeTool(tool);
  }

  private async refresh() {
    this.entries.set(await listLibrary());
  }
}
