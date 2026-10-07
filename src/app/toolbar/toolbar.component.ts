import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  NgbDropdown,
  NgbDropdownItem,
  NgbDropdownMenu,
  NgbDropdownToggle,
} from '@ng-bootstrap/ng-bootstrap';
import { DatePipe } from '@angular/common';
import { listTemplates, Template } from '../templates';
import { Project } from '../projects';

/**
 * The app's header, across the editor and the preview: the project being
 * worked on (its name, whether it's saved, the saved projects) on the left,
 * starting another one and the G-code on the right.
 */
@Component({
  selector: 'app-toolbar',
  imports: [
    NgbDropdown,
    NgbDropdownToggle,
    NgbDropdownMenu,
    NgbDropdownItem,
    DatePipe,
  ],
  template: `
    <header #toolbar class="toolbar">
      <span class="brand app-name">CNC Utils</span>
      <span class="separator app-name" aria-hidden="true"></span>

      <div
        ngbDropdown
        placement="bottom-start bottom-end"
        class="d-inline-block"
        (openChange)="$event && projectsOpened.emit()"
      >
        <button
          ngbDropdownToggle
          class="btn btn-sm project"
          type="button"
          title="Projects saved in this browser: open, save as or delete"
          aria-label="Projects"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 4V12.5h13V5.5H7.5L6 4z" />
          </svg>
          <span
            class="project_name"
            [class.project_name--untitled]="!project()"
          >
            {{ project()?.name || 'Untitled project' }}
          </span>
        </button>
        <div ngbDropdownMenu class="menu">
          <h6 class="dropdown-header menu_header">
            Projects saved in this browser
          </h6>
          <button ngbDropdownItem type="button" (click)="saveAs.emit()">
            <span class="menu_name">Save as new project…</span>
          </button>
          @for (saved of projects(); track saved.id) {
            <div
              class="menu_row"
              [class.menu_row--current]="saved.id === project()?.id"
            >
              <button
                ngbDropdownItem
                type="button"
                class="menu_open"
                [title]="
                  saved.id === project()?.id
                    ? 'Open again as last saved'
                    : 'Open (replaces the current project)'
                "
                (click)="openProject.emit(saved)"
              >
                <span class="menu_name">
                  {{ saved.name }}
                  @if (saved.id === project()?.id) {
                    <span class="menu_badge">
                      {{ pending() ? 'Open · unsaved changes' : 'Open' }}
                    </span>
                  }
                </span>
                <span class="menu_description"
                  >Saved {{ saved.savedAt | date: 'd MMM y, HH:mm' }}</span
                >
              </button>
              <button
                ngbDropdownItem
                type="button"
                class="menu_delete"
                [attr.aria-label]="'Delete project ' + saved.name"
                title="Delete this project"
                (click)="deleteProject.emit(saved)"
              >
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4"
                  />
                </svg>
              </button>
            </div>
          } @empty {
            <p class="menu_empty">No saved projects yet.</p>
          }
        </div>
      </div>

      @if (status(); as s) {
        <span
          class="status"
          [class.status--pending]="pending()"
          role="status"
          [title]="s"
        >
          <span class="status_dot" aria-hidden="true"></span>
          <span class="status_text">{{ s }}</span>
        </span>
      }
      <button
        class="btn btn-sm toolbar_button"
        [class.btn-outline-primary]="pending()"
        [class.btn-outline-secondary]="!pending()"
        type="button"
        [title]="saveTitle()"
        aria-label="Save project"
        [disabled]="!pending()"
        (click)="save.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 2.5h9l2 2v9h-11zM5 2.5v3.5h5.5V2.5M5 13.5V9.5h6v4" />
        </svg>
        <span class="label">Save</span>
      </button>

      @if (working()) {
        <span class="working" role="status" title="Working…">
          <span
            class="spinner-border spinner-border-sm"
            aria-hidden="true"
          ></span>
          <span class="working_label">Working…</span>
        </span>
      }

      <span class="toolbar_spacer"></span>

      <button
        class="btn btn-sm btn-outline-secondary toolbar_button new-button"
        type="button"
        title="Start a new, empty project"
        aria-label="New project"
        (click)="newProject.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M8 7v5M5.5 9.5h5" />
        </svg>
        <span class="label secondary-label">New</span>
      </button>
      @if (templates().length) {
        <div
          ngbDropdown
          placement="bottom-end bottom-start"
          class="d-inline-block"
        >
          <button
            ngbDropdownToggle
            class="btn btn-sm btn-outline-secondary toolbar_button"
            type="button"
            title="Start from a template (replaces the current project)"
            aria-label="Templates"
          >
            <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z"
              />
            </svg>
            <span class="label secondary-label">Templates</span>
          </button>
          <div ngbDropdownMenu class="menu">
            <h6 class="dropdown-header menu_header">
              Opens in place of the current project
            </h6>
            @for (template of templates(); track template.file) {
              <button
                ngbDropdownItem
                type="button"
                (click)="openTemplate.emit(template)"
              >
                <span class="menu_name">{{ template.name }}</span>
                @if (template.description) {
                  <span class="menu_description">{{
                    template.description
                  }}</span>
                }
              </button>
            }
          </div>
        </div>
      }
      <button
        class="btn btn-sm btn-outline-secondary toolbar_button"
        type="button"
        title="Load a project from a previously downloaded .nc file"
        aria-label="Load a .nc file"
        (click)="load.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M2.5 2.5h11" />
        </svg>
        <span class="label secondary-label">Load .nc</span>
      </button>
      <span class="separator" aria-hidden="true"></span>
      <button
        class="btn btn-sm btn-primary toolbar_button"
        type="button"
        title="Download the G-code (the project is embedded in it)"
        aria-label="Download G-code"
        [disabled]="working()"
        (click)="download.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
        </svg>
        <span class="label">G-code</span>
      </button>
    </header>
  `,
  styles: `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--editor-card-bg);
      border-bottom: 1px solid var(--editor-border);

      > :not(.toolbar_spacer) {
        flex: none;
      }
    }

    .brand {
      font-weight: 600;
      font-size: 0.95rem;
      white-space: nowrap;
    }

    .separator {
      width: 1px;
      height: 20px;
      margin: 0 4px;
      background: var(--editor-border);
    }

    .toolbar_spacer {
      flex: 1;
    }

    .toolbar_button,
    .project {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    // The project's name, as a menu: looks like a title until hovered.
    .project {
      --bs-btn-padding-x: 0.5rem;
      --bs-btn-hover-bg: var(--editor-hover-bg);
      --bs-btn-active-bg: var(--editor-hover-bg);
      font-weight: 500;
    }

    .project_name {
      max-width: 18em;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .project_name--untitled {
      color: var(--bs-secondary-color);
      font-style: italic;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
      white-space: nowrap;
    }

    .status_dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--bs-success);
    }

    .status--pending {
      color: var(--bs-warning-text-emphasis);

      .status_dot {
        background: var(--bs-warning);
      }
    }

    .new-button:hover {
      color: var(--bs-danger);
      border-color: var(--bs-danger-border-subtle);
      background: var(--bs-danger-bg-subtle);
    }

    .working {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 6px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
    }

    .icon {
      width: 14px;
      height: 14px;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    // Set by fit() when the window is too narrow for everything: first the
    // status and "Working…" texts go (their dots and spinner stay), then the
    // secondary buttons' labels, then every label, and the name gets shorter,
    // then the app's name.
    .toolbar:not([data-compact='0']) {
      .status_text,
      .working_label {
        display: none;
      }
    }

    .toolbar:is([data-compact='2'], [data-compact='3'], [data-compact='4'])
      .secondary-label {
      display: none;
    }

    .toolbar:is([data-compact='3'], [data-compact='4']) {
      .label {
        display: none;
      }

      .project_name {
        max-width: 9em;
      }

      .toolbar_button {
        --bs-btn-padding-x: 0.45rem;
      }
    }

    .toolbar[data-compact='4'] .app-name {
      display: none;
    }

    // The menus scroll when taller than the window below the toolbar.
    .menu {
      width: min(360px, calc(100vw - 24px));
      max-height: calc(100vh - 64px);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 0 4px;
    }

    .menu_header {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--bs-dropdown-bg);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 10px 14px 8px;
    }

    .menu .dropdown-item {
      display: block;
      white-space: normal;
      padding: 10px 14px;
      border-top: 1px solid var(--bs-border-color-translucent);
    }

    .menu_name {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .menu_description {
      display: block;
      margin-top: 3px;
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--bs-secondary-color);
    }

    .menu .dropdown-item:active .menu_description {
      color: inherit;
    }

    .menu_row {
      display: flex;
      border-top: 1px solid var(--bs-border-color-translucent);

      .dropdown-item {
        border-top: none;
      }
    }

    .menu_row--current {
      box-shadow: inset 3px 0 0 var(--bs-primary);
    }

    .menu .menu_open {
      flex: 1;
      min-width: 0;
    }

    .menu .menu_delete {
      flex: none;
      width: auto;
      display: flex;
      align-items: center;
      padding: 0 14px;
      color: var(--bs-secondary-color);

      &:hover,
      &:focus {
        color: var(--bs-danger);
        background: var(--bs-danger-bg-subtle);
      }
    }

    .menu_badge {
      display: inline-block;
      margin-left: 6px;
      white-space: nowrap;
      font-size: 0.7rem;
      font-weight: 500;
      color: var(--bs-primary);
    }

    .menu_empty {
      margin: 0;
      padding: 10px 14px;
      border-top: 1px solid var(--bs-border-color-translucent);
      font-size: 0.8rem;
      font-style: italic;
      color: var(--bs-secondary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolbarComponent implements AfterViewInit, OnDestroy {
  /** The template projects (`templates/index.json`); fetched once. */
  readonly templates = signal<Template[]>([]);
  /** A computation is running: shows the spinner, blocks the download. */
  readonly working = input(false);
  /** The saved projects, most recent first. */
  readonly projects = input<Project[]>([]);
  /** The saved project being worked on, if any. */
  readonly project = input<Project | null>(null);
  /** Whether there's work not saved as a project. */
  readonly pending = input(false);
  readonly newProject = output();
  readonly load = output();
  readonly openTemplate = output<Template>();
  readonly download = output();
  /** Save over the current project (or as a new one, when there's none). */
  readonly save = output();
  readonly saveAs = output();
  readonly openProject = output<Project>();
  readonly deleteProject = output<Project>();
  /** The projects menu was opened: time to read the list again. */
  readonly projectsOpened = output();

  /** Whether the work is saved, in words; nothing for an empty project. */
  readonly status = computed(() => {
    if (this.project()) {
      return this.pending() ? 'Unsaved changes' : 'Saved';
    }
    return this.pending() ? 'Not saved' : '';
  });

  readonly saveTitle = computed(() => {
    const project = this.project();
    if (!this.pending()) {
      return project
        ? `All changes are saved to “${project.name}”`
        : 'Nothing to save yet';
    }
    return project
      ? `Save the changes to “${project.name}”`
      : 'Save as a project in this browser';
  });

  private readonly toolbar =
    viewChild.required<ElementRef<HTMLElement>>('toolbar');
  private observers: Array<ResizeObserver | MutationObserver> = [];

  constructor() {
    listTemplates().then((templates) => this.templates.set(templates));
  }

  ngAfterViewInit() {
    // Refit when the toolbar is resized or its contents change (the
    // "Working…" indicator, the project's name and status).
    const toolbar = this.toolbar().nativeElement;
    const fit = () => this.fit();
    const resize = new ResizeObserver(fit);
    resize.observe(toolbar);
    const mutation = new MutationObserver(fit);
    mutation.observe(toolbar, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.observers = [resize, mutation];
    fit();
  }

  ngOnDestroy() {
    this.observers.forEach((o) => o.disconnect());
  }

  /** Use the least compact layout in which everything fits. */
  private fit() {
    const toolbar = this.toolbar().nativeElement;
    for (const level of ['0', '1', '2', '3', '4']) {
      toolbar.dataset['compact'] = level;
      if (this.fits(toolbar)) {
        break;
      }
    }
  }

  /**
   * Whether the last item ends within the toolbar's padding (once the
   * spacer has shrunk away, what doesn't fit pushes it out). Not
   * `scrollWidth`: that counts an open menu, which hangs past the edge
   * while it's being opened or closed (before it's positioned, after it's
   * unpositioned).
   */
  private fits(toolbar: HTMLElement) {
    const last = toolbar.lastElementChild;
    if (!last) {
      return true;
    }
    const end =
      toolbar.getBoundingClientRect().right -
      parseFloat(getComputedStyle(toolbar).paddingRight);
    return last.getBoundingClientRect().right <= end + 0.5;
  }
}
