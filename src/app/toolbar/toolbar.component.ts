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
import { listSamples, Sample } from '../samples';

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
      @if (samples().length) {
        <div
          ngbDropdown
          placement="bottom-start bottom-end"
          class="d-inline-block"
        >
          <button
            ngbDropdownToggle
            class="btn btn-sm btn-outline-secondary toolbar_button"
            type="button"
            title="Open an example project (replaces the current one)"
          >
            Samples
          </button>
          <div ngbDropdownMenu class="samples">
            <h6 class="dropdown-header samples_header">
              Opens in place of the current project
            </h6>
            @for (sample of samples(); track sample.file) {
              <button
                ngbDropdownItem
                type="button"
                (click)="openSample.emit(sample)"
              >
                <span class="samples_name">{{ sample.name }}</span>
                @if (sample.description) {
                  <span class="samples_description">{{
                    sample.description
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

    .samples {
      width: min(360px, calc(100vw - 24px));
      padding: 4px 0;
    }

    .samples_header {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 6px 14px 8px;
    }

    .samples .dropdown-item {
      display: block;
      white-space: normal;
      padding: 10px 14px;
      border-top: 1px solid var(--bs-border-color-translucent);
    }

    .samples_name {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .samples_description {
      display: block;
      margin-top: 3px;
      font-size: 0.8rem;
      line-height: 1.4;
      color: var(--bs-secondary-color);
    }

    .samples .dropdown-item:active .samples_description {
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
  /** The sample projects (`samples/index.json`); fetched once. */
  readonly samples = signal<Sample[]>([]);
  /** A computation is running: shows the spinner, blocks the download. */
  readonly working = input(false);
  readonly load = output();
  readonly openSample = output<Sample>();
  readonly download = output();

  constructor() {
    listSamples().then((samples) => this.samples.set(samples));
  }
}
