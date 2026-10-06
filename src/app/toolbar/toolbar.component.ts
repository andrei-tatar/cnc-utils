import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
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
    <header class="toolbar">
      <span class="toolbar_title">CNC Utils</span>
      @if (working()) {
        <span class="working" role="status">
          <span
            class="spinner-border spinner-border-sm"
            aria-hidden="true"
          ></span>
          Working…
        </span>
      }
      <span class="toolbar_spacer"></span>
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
          >
            Templates
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
        (click)="load.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 4V12.5h13V5.5H7.5L6 4z" />
        </svg>
        Load
      </button>
      <button
        class="btn btn-sm btn-primary toolbar_button"
        type="button"
        title="Download the G-code (the project is embedded in it)"
        [disabled]="working()"
        (click)="download.emit()"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
        </svg>
        G-code
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

    .toolbar_title {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .toolbar_spacer {
      flex: 1;
    }

    .toolbar_button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .templates {
      width: min(360px, calc(100vw - 24px));
      padding: 4px 0;
    }

    .templates_header {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 6px 14px 8px;
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
export class ToolbarComponent {
  /** The template projects (`templates/index.json`); fetched once. */
  readonly templates = signal<Template[]>([]);
  /** A computation is running: shows the spinner, blocks the download. */
  readonly working = input(false);
  readonly load = output();
  readonly openTemplate = output<Template>();
  readonly download = output();

  constructor() {
    listTemplates().then((templates) => this.templates.set(templates));
  }
}
