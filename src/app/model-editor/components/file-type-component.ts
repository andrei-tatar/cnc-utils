import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/bootstrap/form-field';
import { readFile } from '../../../util';

/**
 * Picks a text file (an SVG) and stores its content in the field. The file's
 * name goes to the sibling `props.fileNameKey` control, when there is one.
 * Accepts a click (file dialog) or a dropped file.
 */
@Component({
  imports: [FormlyModule, CommonModule],
  standalone: true,
  styles: `
    :host {
      display: block;
      flex: 1;
      min-width: 0;
    }

    .picker {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
      padding: 0.25rem 0.5rem;
      font-size: 0.85rem;

      &.dragging {
        border-color: var(--bs-primary);
        border-style: dashed;
        background: color-mix(in srgb, var(--bs-primary) 6%, transparent);
      }
    }

    .icon {
      width: 16px;
      height: 16px;
      flex: none;
      fill: none;
      stroke: var(--bs-secondary-color);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .file {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .file_name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file_size,
    .hint {
      font-size: 0.7rem;
      color: var(--bs-secondary-color);
      white-space: nowrap;
    }

    .empty {
      color: var(--bs-secondary-color);
    }

    .error {
      margin-top: 4px;
      font-size: 0.75rem;
      color: var(--bs-danger);
    }
  `,
  template: `
    <button
      type="button"
      class="form-control picker"
      [class.dragging]="dragging"
      [class.is-invalid]="showError"
      [title]="
        hasFile
          ? 'Replace the file (or drop one here)'
          : 'Choose a file (or drop one here)'
      "
      (click)="select($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging = false"
      (drop)="onDrop($event)"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z"
        />
        <path d="M9.5 1.5V5H13" />
      </svg>
      @if (hasFile) {
        <span class="file">
          <span class="file_name">{{ fileName || 'loaded file' }}</span>
          <span class="file_size">{{ size }}</span>
        </span>
        <span class="hint">replace</span>
      } @else {
        <span class="file empty">No file chosen</span>
        <span class="hint">choose…</span>
      }
    </button>
    @if (error) {
      <div class="error" role="alert">{{ error }}</div>
    }
  `,
})
export class FileTypeComponent extends FieldType {
  private changes = inject(ChangeDetectorRef);

  dragging = false;
  error: string | null = null;

  get hasFile() {
    return !!this.formControl.value;
  }

  get fileName(): string | undefined {
    const key = this.props['fileNameKey'];
    return key ? this.form.get(key)?.value : undefined;
  }

  get size() {
    const bytes = new Blob([this.formControl.value ?? '']).size;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
  }

  select(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    readFile(this.props['accept']).subscribe((file) => this.load(file));
  }

  onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dragging = true;
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.load(file);
    }
  }

  private async load(file: File) {
    const accept: string | undefined = this.props['accept'];
    if (accept && !matchesAccept(file, accept)) {
      this.error = `“${file.name}” isn't a ${accept} file.`;
      this.changes.markForCheck();
      return;
    }

    this.error = null;
    const content = await file.text();
    this.formControl.setValue(content);
    this.formControl.markAsDirty();

    const key = this.props['fileNameKey'];
    if (key) {
      this.form.get(key)?.setValue(file.name);
    }
    this.changes.markForCheck();
  }
}

/** Same rules as the input's `accept` attribute (extensions or MIME types). */
function matchesAccept(file: File, accept: string) {
  const name = file.name.toLowerCase();
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) =>
      part.startsWith('.')
        ? name.endsWith(part)
        : part.endsWith('/*')
          ? file.type.startsWith(part.slice(0, -1))
          : file.type === part,
    );
}
