import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
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
import { listTemplates, Template } from '../templates';

@Component({
  selector: 'app-toolbar',
  imports: [NgbDropdown, NgbDropdownToggle, NgbDropdownMenu, NgbDropdownItem],
  template: `
    <header #toolbar class="toolbar">
      <span class="toolbar_title">CNC Utils</span>
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
        class="btn btn-sm btn-outline-secondary toolbar_button clear-button"
        type="button"
        title="Start an empty project (the current one is discarded)"
        aria-label="Clear the project"
        (click)="clear.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
        <span class="label">Clear</span>
      </button>
      @if (templates().length) {
        <div
          ngbDropdown
          placement="bottom-start bottom-end"
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
            <span class="label">Templates</span>
          </button>
          <div ngbDropdownMenu class="templates">
            <h6 class="dropdown-header templates_header">
              Opens in place of the current project
            </h6>
            @for (template of templates(); track template.file) {
              <button
                ngbDropdownItem
                type="button"
                (click)="openTemplate.emit(template)"
              >
                <span class="templates_name">{{ template.name }}</span>
                @if (template.description) {
                  <span class="templates_description">{{
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
        aria-label="Load"
        (click)="load.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 4V12.5h13V5.5H7.5L6 4z" />
        </svg>
        <span class="label">Load</span>
      </button>
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
      padding: 8px 12px;
      background: var(--editor-card-bg);
      border-bottom: 1px solid var(--editor-border);
    }

    // Last resort in a very narrow editor: the title is shortened, the
    // buttons never wrap or get pushed out.
    .toolbar_title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      font-size: 0.95rem;
    }

    .toolbar_spacer {
      flex: 1;
    }

    .toolbar_button {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .toolbar > *:not(.toolbar_title, .toolbar_spacer) {
      flex: none;
    }

    .clear-button:hover {
      color: var(--bs-danger);
      border-color: var(--bs-danger-border-subtle);
      background: var(--bs-danger-bg-subtle);
    }

    // Set by fit() when the toolbar is too narrow for everything: first the
    // "Working…" text goes (the spinner stays), then every button's label at
    // once, leaving a row of icon buttons.
    .toolbar[data-compact='1'] .working_label,
    .toolbar[data-compact='2'] .working_label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .toolbar[data-compact='2'] {
      .label {
        display: none;
      }

      .toolbar_button {
        --bs-btn-padding-x: 0.45rem;
      }
    }

    // Scrolls when the list is taller than the window below the toolbar.
    .templates {
      width: min(360px, calc(100vw - 24px));
      max-height: calc(100vh - 64px);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 0 4px;
    }

    .templates_header {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--bs-dropdown-bg);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 10px 14px 8px;
    }

    .templates .dropdown-item {
      display: block;
      white-space: normal;
      padding: 10px 14px;
      border-top: 1px solid var(--bs-border-color-translucent);
    }

    .templates_name {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .templates_description {
      display: block;
      margin-top: 3px;
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--bs-secondary-color);
    }

    .templates .dropdown-item:active .templates_description {
      color: inherit;
    }

    .working {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
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
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolbarComponent implements AfterViewInit, OnDestroy {
  /** The template projects (`templates/index.json`); fetched once. */
  readonly templates = signal<Template[]>([]);
  /** A computation is running: shows the spinner, blocks the download. */
  readonly working = input(false);
  readonly clear = output();
  readonly load = output();
  readonly openTemplate = output<Template>();
  readonly download = output();

  private readonly toolbar =
    viewChild.required<ElementRef<HTMLElement>>('toolbar');
  private observers: Array<ResizeObserver | MutationObserver> = [];

  constructor() {
    listTemplates().then((templates) => this.templates.set(templates));
  }

  ngAfterViewInit() {
    // Refit when the toolbar is resized or its contents change (the
    // "Working…" indicator, the Templates menu appearing).
    const toolbar = this.toolbar().nativeElement;
    const fit = () => this.fit();
    const resize = new ResizeObserver(fit);
    resize.observe(toolbar);
    const mutation = new MutationObserver(fit);
    mutation.observe(toolbar, { childList: true, subtree: true });
    this.observers = [resize, mutation];
    fit();
  }

  ngOnDestroy() {
    this.observers.forEach((o) => o.disconnect());
  }

  /**
   * Use the least compact layout in which the title still fits: everything,
   * then no "Working…" text, then icon-only buttons.
   */
  private fit() {
    const toolbar = this.toolbar().nativeElement;
    const title = toolbar.querySelector<HTMLElement>('.toolbar_title');
    for (const level of ['0', '1', '2']) {
      toolbar.dataset['compact'] = level;
      if (!title || title.scrollWidth <= title.clientWidth) {
        break;
      }
    }
  }
}
