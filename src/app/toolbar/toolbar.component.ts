import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'app-toolbar',
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
  /** A computation is running: shows the spinner, blocks the download. */
  readonly working = input(false);
  readonly load = output();
  readonly download = output();
}
