import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describeTool, ToolType } from '../tools';
import { CloudProjects } from '../../projects/cloud-projects.service';
import {
  entryFor,
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
 * Signed in to Firebase, there's a library there too, the same in every
 * browser: tools are copied or moved between the two.
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

    // What else is done with a library's tool, after adding it: as in the
    // projects menu, quiet icons, the one that removes red when pointed at.
    .actions {
      display: flex;
      flex: none;
    }

    .action {
      display: inline-flex;
      align-items: center;
      padding: 5px 6px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--bs-secondary-color);

      &:hover,
      &:focus-visible {
        color: var(--bs-body-color);
        background: var(--bs-tertiary-bg);
      }
    }

    .action--remove {
      &:hover,
      &:focus-visible {
        color: var(--bs-danger);
        background: var(--bs-danger-bg-subtle);
      }
    }

    .icon {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
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
  imports: [NgTemplateOutlet],
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
        <h3>{{ signedIn() ? 'In this browser' : 'In the library' }}</h3>
        @if (entries().length) {
          <ul>
            @for (entry of entries(); track entry.key) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: entry, cloud: false }"
              />
            }
          </ul>
        } @else {
          <div class="empty">
            The library is empty. Keep this project's tools in it below, or
            import a library file.
          </div>
        }
      </section>

      @if (signedIn()) {
        <section>
          <h3>In Firebase</h3>
          @if (cloudEntries(); as tools) {
            @if (tools.length) {
              <ul>
                @for (entry of tools; track entry.key) {
                  <ng-container
                    [ngTemplateOutlet]="row"
                    [ngTemplateOutletContext]="{
                      $implicit: entry,
                      cloud: true,
                    }"
                  />
                }
              </ul>
            } @else {
              <div class="empty">
                No tools in Firebase yet. Tools kept there are in every browser
                you sign in from.
              </div>
            }
          } @else {
            <div class="empty">Reading the tools in Firebase…</div>
          }
        </section>
      }

      <ng-template #row let-entry let-cloud="cloud">
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
          <span class="actions">
            @if (signedIn()) {
              <button
                type="button"
                class="action"
                [attr.aria-label]="
                  'Copy to ' + other(cloud) + ': ' + label(entry.tool)
                "
                [title]="
                  'Copy to ' +
                  other(cloud) +
                  (entry.tool.name ? ', replacing a tool of the same name' : '')
                "
                (click)="transfer(entry, cloud, false)"
              >
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.5 5.5h8v8h-8zM2.5 10.5v-8h8" />
                </svg>
              </button>
              <button
                type="button"
                class="action"
                [attr.aria-label]="
                  'Move to ' + other(cloud) + ': ' + label(entry.tool)
                "
                [title]="
                  'Move to ' +
                  other(cloud) +
                  (entry.tool.name ? ', replacing a tool of the same name' : '')
                "
                (click)="transfer(entry, cloud, true)"
              >
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  @if (cloud) {
                    <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
                  } @else {
                    <path
                      d="M4.5 13.5a3 3 0 0 1-.4-5.97 4 4 0 0 1 7.8 0 3 3 0 0 1-.4 5.97M8 14V8.5M5.8 10.6 8 8.4l2.2 2.2"
                    />
                  }
                </svg>
              </button>
            }
            <button
              type="button"
              class="action action--remove"
              [attr.aria-label]="
                'Remove from ' + place(cloud) + ': ' + label(entry.tool)
              "
              [title]="'Remove from ' + place(cloud)"
              (click)="remove(entry, cloud)"
            >
              <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4"
                />
              </svg>
            </button>
          </span>
        </li>
      </ng-template>

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
                      ? 'Saves it, replacing a tool of the same name there'
                      : 'Saves it there'
                  "
                >
                  {{ signedIn() ? 'Keep in browser' : 'Keep in library' }}
                </button>
                @if (signedIn()) {
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    (click)="keep(tool, true)"
                    [title]="
                      tool.name
                        ? 'Saves it, replacing a tool of the same name there'
                        : 'Saves it there'
                    "
                  >
                    Keep in Firebase
                  </button>
                }
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

  private readonly cloud = inject(CloudProjects);

  /** The tools kept in this browser. */
  readonly entries = signal<LibraryEntry[]>([]);
  private readonly user = toSignal(this.cloud.user$);
  /** Someone's signed in to Firebase: its library shows too. */
  readonly signedIn = () => !!this.user();
  /** The tools kept in Firebase; null while they're being read. */
  readonly cloudEntries = toSignal(this.cloud.tools$, { initialValue: null });
  readonly status = signal<{ text: string; error?: boolean } | null>(null);

  ngOnInit() {
    this.refresh();
  }

  /** The tool's index (its T number), then what kind of bit it is. */
  describe(tool: LibraryTool) {
    const description = describeTool(tool);
    return typeof tool.index === 'number' && Number.isFinite(tool.index)
      ? `T${tool.index} · ${description}`
      : description;
  }

  /** Where the tools of a library are kept. */
  place(cloud: boolean): string {
    return cloud
      ? 'Firebase'
      : this.signedIn()
        ? 'this browser'
        : 'the library';
  }

  /** The library a tool of the one given is copied or moved to. */
  other(cloud: boolean): string {
    return this.place(!cloud);
  }

  add(entry: LibraryEntry) {
    this.addToProject(structuredClone(entry.tool));
    this.status.set({
      text: `Added “${this.label(entry.tool)}” to the project.`,
    });
  }

  remove(entry: LibraryEntry, cloud = false) {
    return this.attempt(async () => {
      await this.take(entry, cloud);
      return `Removed “${this.label(entry.tool)}” from ${this.place(cloud)}.`;
    });
  }

  keep(tool: ToolType, cloud = false) {
    return this.attempt(async () => {
      await this.put(tool, cloud);
      return `Kept “${this.label(tool)}” in ${this.place(cloud)}.`;
    });
  }

  /** Copies or moves a tool of one library (`cloud`: Firebase's) to the other. */
  transfer(entry: LibraryEntry, cloud: boolean, move: boolean) {
    return this.attempt(async () => {
      await this.put(entry.tool, !cloud);
      if (move) {
        await this.take(entry, cloud);
      }
      return `${move ? 'Moved' : 'Copied'} “${this.label(entry.tool)}” to ${this.other(cloud)}.`;
    });
  }

  private async put(tool: ToolType | LibraryTool, cloud: boolean) {
    if (cloud) {
      await this.cloud.putTool(await entryFor(this.cloudEntries() ?? [], tool));
    } else {
      await saveToLibrary(tool);
    }
  }

  private async take(entry: LibraryEntry, cloud: boolean) {
    if (cloud) {
      await this.cloud.deleteTool(entry.key);
    } else {
      await removeFromLibrary(entry.key);
    }
  }

  /** Does it, then says what it returns, or why it couldn't be done. */
  private async attempt(change: () => Promise<string>) {
    try {
      this.status.set({ text: await change() });
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

  label(tool: LibraryTool) {
    return tool.name || describeTool(tool);
  }

  private async refresh() {
    this.entries.set(await listLibrary());
  }
}
