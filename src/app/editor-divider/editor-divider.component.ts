import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import {
  clampEditorWidth,
  DEFAULT_EDITOR_WIDTH,
  saveEditorWidth,
} from './editor-width';

/**
 * The bar between the editor and the viewer: drag it (or use the arrow
 * keys) to resize the editor, double-click it to reset. The width is saved
 * once a drag ends.
 */
@Component({
  selector: 'app-editor-divider',
  template: '',
  host: {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize editor',
    tabindex: '0',
    title: 'Drag to resize · double-click to reset',
    '[attr.aria-valuenow]': 'width()',
    '[class.resizing]': 'resizing()',
    '(pointerdown)': 'startResize($event)',
    '(pointermove)': 'resize($event)',
    '(pointerup)': 'endResize($event)',
    '(pointercancel)': 'endResize($event)',
    '(lostpointercapture)': 'endResize($event)',
    '(dblclick)': 'setWidth(DEFAULT_EDITOR_WIDTH)',
    '(keydown.arrowleft)': 'setWidth(width() - 20)',
    '(keydown.arrowright)': 'setWidth(width() + 20)',
  },
  styles: `
    :host {
      display: block;
      flex: none;
      width: 6px;
      cursor: col-resize;
      background: var(--editor-border);
      position: relative;
      touch-action: none;
      transition: background-color 120ms ease;
    }

    // Wider invisible hit area than the visible bar.
    :host::before {
      content: '';
      position: absolute;
      inset: 0 -4px;
    }

    :host(:hover),
    :host(:focus-visible),
    :host(.resizing) {
      background: var(--bs-primary);
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class EditorDividerComponent {
  readonly DEFAULT_EDITOR_WIDTH = DEFAULT_EDITOR_WIDTH;

  /** The editor's width, in pixels. */
  readonly width = model.required<number>();
  /** Whether a drag is in progress. */
  readonly resizing = model(false);

  private resizeOffset = 0;

  startResize(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    const divider = event.currentTarget as HTMLElement;
    divider.setPointerCapture(event.pointerId);
    this.resizing.set(true);
    // Keep the grab point under the cursor instead of snapping to it.
    this.resizeOffset = event.clientX - this.width();
    event.preventDefault();
  }

  resize(event: PointerEvent) {
    if (this.resizing()) {
      this.setWidth(event.clientX - this.resizeOffset, false);
    }
  }

  endResize(event: PointerEvent) {
    if (!this.resizing()) {
      return;
    }
    this.resizing.set(false);
    this.setWidth(this.width());

    const divider = event.currentTarget as HTMLElement;
    if (divider.hasPointerCapture(event.pointerId)) {
      divider.releasePointerCapture(event.pointerId);
    }
  }

  setWidth(width: number, persist = true) {
    const clamped = clampEditorWidth(width);
    this.width.set(clamped);
    if (persist) {
      saveEditorWidth(clamped);
    }
  }
}
